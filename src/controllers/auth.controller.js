const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { query, withTransaction } = require('../config/database');
const {
  generateAccessToken, generateRefreshToken,
  verifyRefreshToken, hashToken,
  getTokenExpiry, generateApiKey,
} = require('../utils/jwt');
const { blacklistToken, setCache, deleteCache } = require('../config/redis');
const { successResponse, errorResponse } = require('../utils/response');
const { logAudit } = require('../utils/audit');

// POST /auth/register
const register = async (req, res) => {
  const { email, password, firstName, lastName, tenantName } = req.body;

  await withTransaction(async (client) => {
    // Create tenant (organization) for new registration
    const tenantSlug = tenantName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const uniqueSlug = `${tenantSlug}-${Date.now().toString(36)}`;

    const tenantResult = await client.query(
      `INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING *`,
      [tenantName, uniqueSlug]
    );
    const tenant = tenantResult.rows[0];

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Create admin user for the tenant
    const userResult = await client.query(
      `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role, email_verified)
       VALUES ($1, $2, $3, $4, $5, 'admin', true) RETURNING id, email, first_name, last_name, role, tenant_id`,
      [tenant.id, email.toLowerCase(), passwordHash, firstName, lastName]
    );
    const user = userResult.rows[0];

    // Generate tokens
    const tokenPayload = { userId: user.id, tenantId: tenant.id, role: user.role };
    const accessToken = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);

    // Store hashed refresh token
    const refreshExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await client.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
      [user.id, hashToken(refreshToken), refreshExpiry]
    );

    return successResponse(res, {
      user: { ...user, tenantSlug: tenant.slug, tenantName: tenant.name },
      tokens: { accessToken, refreshToken, expiresIn: process.env.JWT_EXPIRES_IN || '15m' },
    }, 'Registration successful', 201);
  });
};

// POST /auth/login
const login = async (req, res) => {
  const { email, password, tenantSlug } = req.body;

  let queryText = `
    SELECT u.*, t.slug as tenant_slug, t.name as tenant_name, t.plan, t.is_active as tenant_active
    FROM users u JOIN tenants t ON u.tenant_id = t.id
    WHERE u.email = $1 AND u.is_active = true`;
  let params = [email.toLowerCase()];

  if (tenantSlug) {
    queryText += ` AND t.slug = $2`;
    params.push(tenantSlug);
  }

  const { rows } = await query(queryText, params);
  const user = rows[0];

  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return errorResponse(res, 'Invalid email or password', 401);
  }
  if (!user.tenant_active) return errorResponse(res, 'Your organization account is suspended', 403);

  const tokenPayload = { userId: user.id, tenantId: user.tenant_id, role: user.role };
  const accessToken = generateAccessToken(tokenPayload);
  const refreshToken = generateRefreshToken(tokenPayload);

  // Store refresh token
  const refreshExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [user.id, hashToken(refreshToken), refreshExpiry]
  );

  // Update last login
  await query(`UPDATE users SET last_login = NOW() WHERE id = $1`, [user.id]);

  await logAudit(user.tenant_id, user.id, 'user.login', 'user', user.id, {}, req.ip);

  return successResponse(res, {
    user: {
      id: user.id, email: user.email,
      firstName: user.first_name, lastName: user.last_name,
      role: user.role, tenantSlug: user.tenant_slug,
      tenantName: user.tenant_name, plan: user.plan,
    },
    tokens: { accessToken, refreshToken, expiresIn: process.env.JWT_EXPIRES_IN || '15m' },
  }, 'Login successful');
};

// POST /auth/refresh
const refreshToken = async (req, res) => {
  const { refreshToken: token } = req.body;
  if (!token) return errorResponse(res, 'Refresh token required', 400);

  try {
    const decoded = verifyRefreshToken(token);
    const tokenHash = hashToken(token);

    const { rows } = await query(
      `SELECT rt.*, u.role, u.is_active, t.is_active as tenant_active
       FROM refresh_tokens rt
       JOIN users u ON rt.user_id = u.id
       JOIN tenants t ON u.tenant_id = t.id
       WHERE rt.token_hash = $1 AND rt.expires_at > NOW()`,
      [tokenHash]
    );

    if (!rows[0] || !rows[0].is_active) return errorResponse(res, 'Invalid refresh token', 401);

    // Rotate: delete old, create new
    await query(`DELETE FROM refresh_tokens WHERE token_hash = $1`, [tokenHash]);

    const tokenPayload = { userId: decoded.userId, tenantId: decoded.tenantId, role: rows[0].role };
    const newAccessToken = generateAccessToken(tokenPayload);
    const newRefreshToken = generateRefreshToken(tokenPayload);

    const refreshExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
      [decoded.userId, hashToken(newRefreshToken), refreshExpiry]
    );

    return successResponse(res, {
      tokens: { accessToken: newAccessToken, refreshToken: newRefreshToken },
    }, 'Token refreshed');
  } catch (err) {
    return errorResponse(res, 'Invalid or expired refresh token', 401);
  }
};

// POST /auth/logout
const logout = async (req, res) => {
  const { refreshToken: token } = req.body;

  // Blacklist the access token
  const tokenExpiry = getTokenExpiry(process.env.JWT_EXPIRES_IN || '15m');
  await blacklistToken(req.token, tokenExpiry);

  // Delete refresh token
  if (token) {
    await query(`DELETE FROM refresh_tokens WHERE token_hash = $1`, [hashToken(token)]);
  }

  await logAudit(req.user.tenant_id, req.user.id, 'user.logout', 'user', req.user.id, {}, req.ip);

  return successResponse(res, null, 'Logged out successfully');
};

// GET /auth/me
const getMe = async (req, res) => {
  const { rows } = await query(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.avatar_url,
            u.last_login, u.created_at,
            t.name as tenant_name, t.slug as tenant_slug, t.plan
     FROM users u JOIN tenants t ON u.tenant_id = t.id
     WHERE u.id = $1`,
    [req.user.id]
  );
  return successResponse(res, rows[0]);
};

// POST /auth/change-password
const changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  const { rows } = await query(`SELECT password_hash FROM users WHERE id = $1`, [req.user.id]);
  if (!(await bcrypt.compare(currentPassword, rows[0].password_hash))) {
    return errorResponse(res, 'Current password is incorrect', 400);
  }

  const newHash = await bcrypt.hash(newPassword, 12);
  await query(`UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [newHash, req.user.id]);

  // Invalidate all sessions
  await query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [req.user.id]);

  return successResponse(res, null, 'Password changed successfully');
};

module.exports = { register, login, refreshToken, logout, getMe, changePassword };
