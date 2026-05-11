const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const { getApiKeys, createApiKey, deleteApiKey, updateApiKey } = require('../controllers/apiKey.controller');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

router.use(authenticate);

router.get('/', getApiKeys);
router.post('/', [
  body('name').trim().notEmpty(),
  body('scopes').optional().isArray(),
  body('expiresAt').optional().isISO8601(),
], validate, createApiKey);
router.patch('/:id', updateApiKey);
router.delete('/:id', deleteApiKey);

module.exports = router;
