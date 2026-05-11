const express = require('express');
const router = express.Router();
const { getMyTenant, updateTenant, getAuditLogs, getTenantStats } = require('../controllers/tenant.controller');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

router.get('/me', getMyTenant);
router.patch('/me', authorize('admin'), updateTenant);
router.get('/me/audit-logs', authorize('admin'), getAuditLogs);
router.get('/me/stats', authorize('admin', 'manager'), getTenantStats);

module.exports = router;
