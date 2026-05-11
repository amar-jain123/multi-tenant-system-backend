const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const { register, login, refreshToken, logout, getMe, changePassword } = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth');
const { authRateLimiter } = require('../middleware/rateLimiter');
const { validate } = require('../middleware/validate');

/**
 * @swagger
 * /auth/register:
 *   post:
 *     summary: Register a new organization and admin user
 *     tags: [Auth]
 */
router.post('/register', authRateLimiter, [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('firstName').trim().notEmpty(),
  body('lastName').trim().notEmpty(),
  body('tenantName').trim().notEmpty().withMessage('Organization name is required'),
], validate, register);

router.post('/login', authRateLimiter, [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
], validate, login);

router.post('/refresh', [body('refreshToken').notEmpty()], validate, refreshToken);

router.post('/logout', authenticate, [body('refreshToken').optional()], logout);

router.get('/me', authenticate, getMe);

router.post('/change-password', authenticate, [
  body('currentPassword').notEmpty(),
  body('newPassword').isLength({ min: 8 }),
], validate, changePassword);

module.exports = router;
