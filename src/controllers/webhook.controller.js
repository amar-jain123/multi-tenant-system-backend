const { query } = require('../config/database');
const { successResponse, errorResponse, paginatedResponse, getPagination, buildPaginationMeta } = require('../utils/response');
const crypto = require('crypto');

// GET /webhooks
const getWebhooks = async (req, res) => {
  const { rows } = await query(
    `SELECT id, url, events, is_active, last_triggered_at, failure_count, created_at
     FROM webhooks WHERE tenant_id = $1 ORDER BY created_at DESC`,
    [req.user.tenant_id]
  );
  return successResponse(res, rows);
};

// POST /webhooks
const createWebhook = async (req, res) => {
  const { url, events } = req.body;
  const secret = crypto.randomBytes(32).toString('hex');

  const { rows } = await query(
    `INSERT INTO webhooks (tenant_id, url, events, secret) VALUES ($1, $2, $3, $4)
     RETURNING id, url, events, is_active, created_at`,
    [req.user.tenant_id, url, JSON.stringify(events), secret]
  );

  return successResponse(res, { ...rows[0], secret }, 'Webhook created. Save the secret — it will not be shown again.', 201);
};

// PATCH /webhooks/:id
const updateWebhook = async (req, res) => {
  const { url, events, isActive } = req.body;
  const updates = []; const params = []; let idx = 1;

  if (url !== undefined) { updates.push(`url = $${idx++}`); params.push(url); }
  if (events !== undefined) { updates.push(`events = $${idx++}`); params.push(JSON.stringify(events)); }
  if (isActive !== undefined) { updates.push(`is_active = $${idx++}`); params.push(isActive); }

  if (!updates.length) return errorResponse(res, 'Nothing to update', 400);
  params.push(req.params.id, req.user.tenant_id);

  const { rows } = await query(
    `UPDATE webhooks SET ${updates.join(', ')} WHERE id = $${idx++} AND tenant_id = $${idx} RETURNING *`,
    params
  );

  if (!rows[0]) return errorResponse(res, 'Webhook not found', 404);
  return successResponse(res, rows[0]);
};

// DELETE /webhooks/:id
const deleteWebhook = async (req, res) => {
  const { rowCount } = await query(
    `DELETE FROM webhooks WHERE id = $1 AND tenant_id = $2`, [req.params.id, req.user.tenant_id]
  );
  if (!rowCount) return errorResponse(res, 'Webhook not found', 404);
  return successResponse(res, null, 'Webhook deleted');
};

// GET /webhooks/:id/deliveries
const getDeliveries = async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);

  const { rows: countRows } = await query(
    `SELECT COUNT(*) FROM webhook_deliveries wd
     JOIN webhooks w ON wd.webhook_id = w.id
     WHERE wd.webhook_id = $1 AND w.tenant_id = $2`,
    [req.params.id, req.user.tenant_id]
  );

  const { rows } = await query(
    `SELECT wd.* FROM webhook_deliveries wd
     JOIN webhooks w ON wd.webhook_id = w.id
     WHERE wd.webhook_id = $1 AND w.tenant_id = $2
     ORDER BY wd.created_at DESC LIMIT $3 OFFSET $4`,
    [req.params.id, req.user.tenant_id, limit, offset]
  );

  return paginatedResponse(res, rows, buildPaginationMeta(parseInt(countRows[0].count), page, limit));
};

module.exports = { getWebhooks, createWebhook, updateWebhook, deleteWebhook, getDeliveries };
