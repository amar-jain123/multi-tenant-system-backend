const { query } = require('../config/database');
const { successResponse, errorResponse } = require('../utils/response');
const { deleteCache } = require('../config/redis');
const { logAudit } = require('../utils/audit');

// GET /tenants/me
const getMyTenant = async (req, res) => {
  const { rows } = await query(
    `SELECT t.*,
            (SELECT COUNT(*) FROM users WHERE tenant_id = t.id AND is_active = true) as user_count,
            (SELECT COUNT(*) FROM projects WHERE tenant_id = t.id) as project_count
     FROM tenants t WHERE t.id = $1`,
    [req.user.tenant_id]
  );
  return successResponse(res, rows[0]);
};

// PATCH /tenants/me
const updateTenant = async (req, res) => {
  const { name, settings } = req.body;
  const updates = []; const params = []; let idx = 1;

  if (name !== undefined) { updates.push(`name = $${idx++}`); params.push(name); }
  if (settings !== undefined) { updates.push(`settings = $${idx++}`); params.push(JSON.stringify(settings)); }
  if (!updates.length) return errorResponse(res, 'Nothing to update', 400);

  updates.push('updated_at = NOW()');
  params.push(req.user.tenant_id);

  const { rows } = await query(
    `UPDATE tenants SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
    params
  );

  await deleteCache(`tenant:${rows[0].id}`);
  await deleteCache(`tenant:${rows[0].slug}`);
  await logAudit(req.user.tenant_id, req.user.id, 'tenant.updated', 'tenant', rows[0].id, req.body, req.ip);

  return successResponse(res, rows[0], 'Organization updated');
};

// GET /tenants/me/audit-logs
const getAuditLogs = async (req, res) => {
  const { page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;

  const { rows } = await query(
    `SELECT al.*, u.email, u.first_name || ' ' || u.last_name as user_name
     FROM audit_logs al LEFT JOIN users u ON al.user_id = u.id
     WHERE al.tenant_id = $1
     ORDER BY al.created_at DESC LIMIT $2 OFFSET $3`,
    [req.user.tenant_id, Math.min(100, limit), offset]
  );

  return successResponse(res, rows);
};

// GET /tenants/me/stats
const getTenantStats = async (req, res) => {
  const tenantId = req.user.tenant_id;

  const [usersResult, projectsResult, tasksResult, recentActivityResult] = await Promise.all([
    query(`SELECT COUNT(*) as total, SUM(CASE WHEN is_active THEN 1 ELSE 0 END) as active FROM users WHERE tenant_id = $1`, [tenantId]),
    query(`SELECT COUNT(*) as total, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active FROM projects WHERE tenant_id = $1`, [tenantId]),
    query(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done,
        SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
        SUM(CASE WHEN status = 'todo' THEN 1 ELSE 0 END) as todo,
        SUM(CASE WHEN due_date < NOW() AND status != 'done' THEN 1 ELSE 0 END) as overdue
       FROM tasks WHERE tenant_id = $1`, [tenantId]
    ),
    query(
      `SELECT action, COUNT(*) as count FROM audit_logs
       WHERE tenant_id = $1 AND created_at > NOW() - INTERVAL '7 days'
       GROUP BY action ORDER BY count DESC LIMIT 10`, [tenantId]
    ),
  ]);

  return successResponse(res, {
    users: usersResult.rows[0],
    projects: projectsResult.rows[0],
    tasks: tasksResult.rows[0],
    recentActivity: recentActivityResult.rows,
  });
};

module.exports = { getMyTenant, updateTenant, getAuditLogs, getTenantStats };
