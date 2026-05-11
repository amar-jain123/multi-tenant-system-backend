const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const { getTasks, getTaskById, createTask, updateTask, deleteTask, addComment, deleteComment } = require('../controllers/task.controller');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

router.use(authenticate);

router.get('/', getTasks);
router.get('/:id', getTaskById);

router.post('/', [
  body('projectId').isUUID(),
  body('title').trim().notEmpty(),
  body('status').optional().isIn(['todo', 'in_progress', 'in_review', 'done', 'cancelled']),
  body('priority').optional().isIn(['low', 'medium', 'high', 'urgent']),
  body('assigneeId').optional().isUUID(),
  body('dueDate').optional().isISO8601(),
  body('estimatedHours').optional().isFloat({ min: 0 }),
  body('tags').optional().isArray(),
  body('parentTaskId').optional().isUUID(),
], validate, createTask);

router.patch('/:id', [
  body('status').optional().isIn(['todo', 'in_progress', 'in_review', 'done', 'cancelled']),
  body('priority').optional().isIn(['low', 'medium', 'high', 'urgent']),
], validate, updateTask);

router.delete('/:id', deleteTask);

router.post('/:id/comments', [
  body('content').trim().notEmpty().withMessage('Comment content is required'),
], validate, addComment);

router.delete('/:id/comments/:commentId', deleteComment);

module.exports = router;
