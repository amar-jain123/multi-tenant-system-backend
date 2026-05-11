// webhook.routes.js
const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const { getWebhooks, createWebhook, updateWebhook, deleteWebhook, getDeliveries } = require('../controllers/webhook.controller');
const { authenticate, authorize } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

router.use(authenticate, authorize('admin', 'manager'));

router.get('/', getWebhooks);
router.post('/', [
  body('url').isURL(),
  body('events').isArray({ min: 1 }),
], validate, createWebhook);
router.patch('/:id', updateWebhook);
router.delete('/:id', deleteWebhook);
router.get('/:id/deliveries', getDeliveries);

module.exports = router;
