const bcrypt = require('bcryptjs');
const { query } = require('../config/database');
const { successResponse, errorResponse, paginatedResponse, getPagination, buildPaginationMeta } = require('../utils/response');
const { deleteCache } = require('../config/redis');
const { logAudit } = require('../utils/audit');

// GET /users
const getUsers = async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const { search, role, isActive } = req.query;
  const tenantId = req.user.tenant_id;

  let conditions = ['u.tenant_id = $1'];
  let params = [tenantId];
  let paramIdx = 2;

  if (search) {
    conditions.push(`(u.email ILIKE $${paramIdx} OR u.first_name ILIKE $${paramIdx} OR u.last_name ILIKE $${paramIdx})`);
    params.push(`%${search}%`);
    paramIdx++;
  }
  if (role) { conditions.push(`u.role = $${paramIdx++}`); params.push(role); }
  if (isActive !== undefined) { conditions.push(`u.is_active = $${paramIdx++}`); params.push(isActive === 'true'); }

  const where = conditions.join(' AND ');

  const { rows: countRows } = await query(`SELECT COUNT(*) FROM users u WHERE ${where}`, params);
  const total = parseInt(countRows[0].count);

  const { rows } = await query(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.is_active,
            u.last_login, u.created_at, u.avatar_url
     FROM users u WHERE ${where}
     ORDER BY u.created_at DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
    [...params, limit, offset]
  );

  return paginatedResponse(res, rows, buildPaginationMeta(total, page, limit));
};

// GET /users/:id
const getUserById = async (req, res) => {
  const { rows } = await query(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.is_active,
            u.last_login, u.created_at, u.avatar_url
     FROM users u WHERE u.id = $1 AND u.tenant_id = $2`,
    [req.params.id, req.user.tenant_id]
  );
  if (!rows[0]) return errorResponse(res, 'User not found', 404);
  return successResponse(res, rows[0]);
};

// POST /users (invite user)
const createUser = async (req, res) => {
  const { email, firstName, lastName, role, password } = req.body;
  const tenantId = req.user.tenant_id;

  const passwordHash = await bcrypt.hash(password || Math.random().toString(36), 12);

  const { rows } = await query(
    `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, email, first_name, last_name, role, created_at`,
    [tenantId, email.toLowerCase(), passwordHash, firstName, lastName, role || 'member']
  );

  await logAudit(tenantId, req.user.id, 'user.created', 'user', rows[0].id, { email }, req.ip);
  return successResponse(res, rows[0], 'User created successfully', 201);
};

// PATCH /users/:id
const updateUser = async (req, res) => {
  const { firstName, lastName, role, isActive, avatarUrl } = req.body;
  const tenantId = req.user.tenant_id;

  // Non-admins can only update themselves
  if (req.user.role !== 'admin' && req.params.id !== req.user.id) {
    return errorResponse(res, 'Insufficient permissions', 403);
  }

  const updates = [];
  const params = [];
  let idx = 1;

  if (firstName !== undefined) { updates.push(`first_name = $${idx++}`); params.push(firstName); }
  if (lastName !== undefined) { updates.push(`last_name = $${idx++}`); params.push(lastName); }
  if (role !== undefined && req.user.role === 'admin') { updates.push(`role = $${idx++}`); params.push(role); }
  if (isActive !== undefined && req.user.role === 'admin') { updates.push(`is_active = $${idx++}`); params.push(isActive); }
  if (avatarUrl !== undefined) { updates.push(`avatar_url = $${idx++}`); params.push(avatarUrl); }

  if (!updates.length) return errorResponse(res, 'No fields to update', 400);

  updates.push(`updated_at = NOW()`);
  params.push(req.params.id, tenantId);

  const { rows } = await query(
    `UPDATE users SET ${updates.join(', ')} WHERE id = $${idx++} AND tenant_id = $${idx}
     RETURNING id, email, first_name, last_name, role, is_active, avatar_url`,
    params
  );

  if (!rows[0]) return errorResponse(res, 'User not found', 404);
  await logAudit(tenantId, req.user.id, 'user.updated', 'user', rows[0].id, req.body, req.ip);

  return successResponse(res, rows[0], 'User updated successfully');
};

// DELETE /users/:id
const deleteUser = async (req, res) => {
  if (req.params.id === req.user.id) return errorResponse(res, 'Cannot delete yourself', 400);

  const { rowCount } = await query(
    `UPDATE users SET is_active = false WHERE id = $1 AND tenant_id = $2`,
    [req.params.id, req.user.tenant_id]
  );

  if (!rowCount) return errorResponse(res, 'User not found', 404);
  await logAudit(req.user.tenant_id, req.user.id, 'user.deactivated', 'user', req.params.id, {}, req.ip);

  return successResponse(res, null, 'User deactivated successfully');
};

module.exports = { getUsers, getUserById, createUser, updateUser, deleteUser };
