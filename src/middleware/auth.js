const { verifyAccessToken } = require('../utils/jwt');
const { isTokenBlacklisted } = require('../config/redis');
const { query } = require('../config/database');
const { errorResponse } = require('../utils/response');
const { logAudit } = require('../utils/audit');

// JWT Auth middleware
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return errorResponse(res, 'No token provided', 401);
    }

    const token = authHeader.split(' ')[1];

    // Check blacklist
    const blacklisted = await isTokenBlacklisted(token);
    if (blacklisted) {
      return errorResponse(res, 'Token has been revoked', 401);
    }

    // Verify token
    const decoded = verifyAccessToken(token);

    // Fetch user from DB
    const { rows } = await query(
      `SELECT u.*, t.slug as tenant_slug, t.plan, t.is_active as tenant_active
       FROM users u
       JOIN tenants t ON u.tenant_id = t.id
       WHERE u.id = $1 AND u.is_active = true`,
      [decoded.userId]
    );

    if (!rows[0]) return errorResponse(res, 'User not found', 401);
    if (!rows[0].tenant_active) return errorResponse(res, 'Tenant is inactive', 403);

    req.user = rows[0];
    req.token = token;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') return errorResponse(res, 'Token expired', 401);
    if (err.name === 'JsonWebTokenError') return errorResponse(res, 'Invalid token', 401);
    next(err);
  }
};

// API Key auth middleware
const authenticateApiKey = async (req, res, next) => {
  try {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) return next(); // fall through to JWT if no API key

    const crypto = require('crypto');
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

    const { rows } = await query(
      `SELECT ak.*, u.email, u.role, u.tenant_id, t.slug as tenant_slug, t.is_active as tenant_active
       FROM api_keys ak
       JOIN users u ON ak.user_id = u.id
       JOIN tenants t ON ak.tenant_id = t.id
       WHERE ak.key_hash = $1 AND ak.is_active = true
         AND (ak.expires_at IS NULL OR ak.expires_at > NOW())`,
      [keyHash]
    );

    if (!rows[0]) return errorResponse(res, 'Invalid API key', 401);
    if (!rows[0].tenant_active) return errorResponse(res, 'Tenant is inactive', 403);

    // Update last used
    await query('UPDATE api_keys SET last_used_at = NOW() WHERE id = $1', [rows[0].id]);

    req.user = rows[0];
    req.apiKeyScopes = rows[0].scopes;
    next();
  } catch (err) {
    next(err);
  }
};

// Role-based access control
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) return errorResponse(res, 'Unauthorized', 401);
    if (!roles.includes(req.user.role)) {
      return errorResponse(res, `Access denied. Required roles: ${roles.join(', ')}`, 403);
    }
    next();
  };
};

// Tenant isolation - ensures user can only access their tenant's data
const enforceTenant = (req, res, next) => {
  if (req.params.tenantId && req.params.tenantId !== req.user.tenant_id) {
    return errorResponse(res, 'Access denied to this tenant', 403);
  }
  next();
};

module.exports = { authenticate, authenticateApiKey, authorize, enforceTenant };
