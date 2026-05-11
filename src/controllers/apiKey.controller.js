const crypto = require('crypto');
const { query } = require('../config/database');
const { successResponse, errorResponse } = require('../utils/response');
const { generateApiKey } = require('../utils/jwt');

// GET /api-keys
const getApiKeys = async (req, res) => {
  const { rows } = await query(
    `SELECT id, name, key_prefix, scopes, last_used_at, expires_at, is_active, created_at
     FROM api_keys WHERE tenant_id = $1 AND user_id = $2 ORDER BY created_at DESC`,
    [req.user.tenant_id, req.user.id]
  );
  return successResponse(res, rows);
};

// POST /api-keys
const createApiKey = async (req, res) => {
  const { name, scopes = [], expiresAt } = req.body;
  const rawKey = generateApiKey();
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const keyPrefix = rawKey.substring(0, 14); // "sk_live_" + 6 chars

  const { rows } = await query(
    `INSERT INTO api_keys (tenant_id, user_id, name, key_hash, key_prefix, scopes, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, name, key_prefix, scopes, expires_at, created_at`,
    [req.user.tenant_id, req.user.id, name, keyHash, keyPrefix, JSON.stringify(scopes), expiresAt || null]
  );

  return successResponse(res, {
    ...rows[0],
    key: rawKey, // Only shown once!
  }, 'API key created. Save it now — it will not be shown again.', 201);
};

// DELETE /api-keys/:id
const deleteApiKey = async (req, res) => {
  const { rowCount } = await query(
    `DELETE FROM api_keys WHERE id = $1 AND user_id = $2 AND tenant_id = $3`,
    [req.params.id, req.user.id, req.user.tenant_id]
  );
  if (!rowCount) return errorResponse(res, 'API key not found', 404);
  return successResponse(res, null, 'API key revoked');
};

// PATCH /api-keys/:id
const updateApiKey = async (req, res) => {
  const { name, isActive, scopes } = req.body;
  const updates = []; const params = []; let idx = 1;

  if (name !== undefined) { updates.push(`name = $${idx++}`); params.push(name); }
  if (isActive !== undefined) { updates.push(`is_active = $${idx++}`); params.push(isActive); }
  if (scopes !== undefined) { updates.push(`scopes = $${idx++}`); params.push(JSON.stringify(scopes)); }

  if (!updates.length) return errorResponse(res, 'Nothing to update', 400);
  params.push(req.params.id, req.user.id, req.user.tenant_id);

  const { rows } = await query(
    `UPDATE api_keys SET ${updates.join(', ')} WHERE id = $${idx++} AND user_id = $${idx++} AND tenant_id = $${idx}
     RETURNING id, name, key_prefix, scopes, is_active, expires_at`,
    params
  );

  if (!rows[0]) return errorResponse(res, 'API key not found', 404);
  return successResponse(res, rows[0]);
};

module.exports = { getApiKeys, createApiKey, deleteApiKey, updateApiKey };
