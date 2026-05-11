// user.routes.js
const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const { getUsers, getUserById, createUser, updateUser, deleteUser } = require('../controllers/user.controller');
const { authenticate, authorize } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

router.use(authenticate);

router.get('/', getUsers);
router.get('/:id', getUserById);

router.post('/', authorize('admin'), [
  body('email').isEmail().normalizeEmail(),
  body('firstName').trim().notEmpty(),
  body('lastName').trim().notEmpty(),
  body('role').optional().isIn(['admin', 'manager', 'member', 'viewer']),
], validate, createUser);

router.patch('/:id', [
  body('role').optional().isIn(['admin', 'manager', 'member', 'viewer']),
], validate, updateUser);

router.delete('/:id', authorize('admin'), deleteUser);

module.exports = router;
