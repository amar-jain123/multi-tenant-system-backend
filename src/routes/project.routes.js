const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const {
  getProjects, getProjectById, createProject,
  updateProject, deleteProject, addMember, removeMember,
} = require('../controllers/project.controller');
const { authenticate, authorize } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

router.use(authenticate);

router.get('/', getProjects);
router.get('/:id', getProjectById);

router.post('/', [
  body('name').trim().notEmpty().withMessage('Project name is required'),
  body('description').optional().trim(),
  body('memberIds').optional().isArray(),
], validate, createProject);

router.patch('/:id', [
  body('status').optional().isIn(['active', 'archived', 'completed']),
], validate, updateProject);

router.delete('/:id', authorize('admin', 'manager'), deleteProject);

router.post('/:id/members', authorize('admin', 'manager'), [
  body('userId').isUUID(),
  body('role').optional().isIn(['lead', 'member', 'viewer']),
], validate, addMember);

router.delete('/:id/members/:userId', authorize('admin', 'manager'), removeMember);

module.exports = router;
