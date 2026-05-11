const crypto = require('crypto');
const { query } = require('../config/database');
const logger = require('../utils/logger');

const triggerWebhooks = async (tenantId, event, payload) => {
  try {
    const { rows: webhooks } = await query(
      `SELECT * FROM webhooks WHERE tenant_id = $1 AND is_active = true AND events @> $2::jsonb`,
      [tenantId, JSON.stringify([event])]
    );

    for (const webhook of webhooks) {
      deliverWebhook(webhook, event, payload).catch(err =>
        logger.error('Webhook delivery error:', err)
      );
    }
  } catch (err) {
    logger.error('triggerWebhooks error:', err);
  }
};

const deliverWebhook = async (webhook, event, payload) => {
  const body = JSON.stringify({
    id: crypto.randomUUID(),
    event,
    payload,
    timestamp: new Date().toISOString(),
  });

  const signature = crypto
    .createHmac('sha256', webhook.secret || process.env.WEBHOOK_SECRET)
    .update(body)
    .digest('hex');

  let responseStatus = null;
  let responseBody = null;
  let delivered = false;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': `sha256=${signature}`,
        'X-Webhook-Event': event,
      },
      body,
      signal: controller.signal,
    });

    clearTimeout(timeout);
    responseStatus = response.status;
    responseBody = await response.text();
    delivered = response.ok;
  } catch (err) {
    responseBody = err.message;
  }

  // Log delivery
  await query(
    `INSERT INTO webhook_deliveries (webhook_id, event, payload, response_status, response_body, delivered_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [webhook.id, event, JSON.stringify(payload), responseStatus, responseBody, delivered ? new Date() : null]
  );

  // Update failure count
  if (!delivered) {
    await query(
      `UPDATE webhooks SET failure_count = failure_count + 1,
       is_active = CASE WHEN failure_count >= 10 THEN false ELSE is_active END
       WHERE id = $1`,
      [webhook.id]
    );
  } else {
    await query(
      `UPDATE webhooks SET last_triggered_at = NOW(), failure_count = 0 WHERE id = $1`,
      [webhook.id]
    );
  }
};

module.exports = { triggerWebhooks, deliverWebhook };
