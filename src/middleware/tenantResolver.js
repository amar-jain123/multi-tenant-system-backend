const { query } = require('../config/database');
const { getCache, setCache } = require('../config/redis');
const { errorResponse } = require('../utils/response');

// Resolves tenant from X-Tenant-ID header or subdomain
const tenantResolver = async (req, res, next) => {
  try {
    // Skip for auth routes (login/register don't need tenant context)
    const publicPaths = ['/api/v1/auth/login', '/api/v1/auth/register', '/api/v1/auth/refresh'];
    if (publicPaths.some(path => req.path.includes(path))) return next();

    let tenantIdentifier = req.headers['x-tenant-id'];

    // Try subdomain if no header
    if (!tenantIdentifier && req.hostname) {
      const parts = req.hostname.split('.');
      if (parts.length >= 3) tenantIdentifier = parts[0]; // e.g., acme.saas.com
    }

    if (!tenantIdentifier) return next(); // Will be resolved via JWT user

    // Cache check
    const cacheKey = `tenant:${tenantIdentifier}`;
    let tenant = await getCache(cacheKey);

    if (!tenant) {
      const { rows } = await query(
        `SELECT id, name, slug, plan, is_active, settings FROM tenants
         WHERE (id = $1 OR slug = $1) AND is_active = true`,
        [tenantIdentifier]
      );
      if (!rows[0]) return errorResponse(res, 'Tenant not found', 404);
      tenant = rows[0];
      await setCache(cacheKey, tenant, 300); // cache 5 min
    }

    req.tenant = tenant;
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = { tenantResolver };
