const { query } = require('../config/database');
const logger = require('./logger');

const logAudit = async (tenantId, userId, action, resourceType, resourceId, metadata = {}, ipAddress = null) => {
  try {
    await query(
      `INSERT INTO audit_logs (tenant_id, user_id, action, resource_type, resource_id, metadata, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [tenantId, userId, action, resourceType, resourceId, JSON.stringify(metadata), ipAddress]
    );
  } catch (err) {
    logger.error('Audit log failed:', err);
  }
};

module.exports = { logAudit };
