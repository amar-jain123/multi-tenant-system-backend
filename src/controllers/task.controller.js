const { query, withTransaction } = require('../config/database');
const { successResponse, errorResponse, paginatedResponse, getPagination, buildPaginationMeta } = require('../utils/response');
const { logAudit } = require('../utils/audit');
const { triggerWebhooks } = require('../services/webhook.service');

// GET /tasks
const getTasks = async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const { projectId, status, priority, assigneeId, search, sortBy = 'created_at', sortDir = 'DESC' } = req.query;
  const tenantId = req.user.tenant_id;

  const allowedSort = ['created_at', 'updated_at', 'due_date', 'priority', 'status', 'position'];
  const sortField = allowedSort.includes(sortBy) ? sortBy : 'created_at';
  const sortDirection = sortDir.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  let conditions = ['t.tenant_id = $1'];
  let params = [tenantId];
  let idx = 2;

  if (projectId) { conditions.push(`t.project_id = $${idx++}`); params.push(projectId); }
  if (status) { conditions.push(`t.status = $${idx++}`); params.push(status); }
  if (priority) { conditions.push(`t.priority = $${idx++}`); params.push(priority); }
  if (assigneeId) { conditions.push(`t.assignee_id = $${idx++}`); params.push(assigneeId); }
  if (search) { conditions.push(`t.title ILIKE $${idx++}`); params.push(`%${search}%`); }

  const where = conditions.join(' AND ');

  const { rows: countRows } = await query(`SELECT COUNT(*) FROM tasks t WHERE ${where}`, params);
  const { rows } = await query(
    `SELECT t.*, 
            a.first_name || ' ' || a.last_name as assignee_name, a.avatar_url as assignee_avatar,
            r.first_name || ' ' || r.last_name as reporter_name,
            p.name as project_name,
            (SELECT COUNT(*) FROM tasks sub WHERE sub.parent_task_id = t.id) as subtask_count,
            (SELECT COUNT(*) FROM task_comments tc WHERE tc.task_id = t.id) as comment_count
     FROM tasks t
     LEFT JOIN users a ON t.assignee_id = a.id
     JOIN users r ON t.reporter_id = r.id
     JOIN projects p ON t.project_id = p.id
     WHERE ${where}
     ORDER BY t.${sortField} ${sortDirection}
     LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, limit, offset]
  );

  return paginatedResponse(res, rows, buildPaginationMeta(parseInt(countRows[0].count), page, limit));
};

// GET /tasks/:id
const getTaskById = async (req, res) => {
  const { rows } = await query(
    `SELECT t.*,
            a.first_name || ' ' || a.last_name as assignee_name, a.avatar_url as assignee_avatar,
            r.first_name || ' ' || r.last_name as reporter_name,
            p.name as project_name
     FROM tasks t
     LEFT JOIN users a ON t.assignee_id = a.id
     JOIN users r ON t.reporter_id = r.id
     JOIN projects p ON t.project_id = p.id
     WHERE t.id = $1 AND t.tenant_id = $2`,
    [req.params.id, req.user.tenant_id]
  );

  if (!rows[0]) return errorResponse(res, 'Task not found', 404);

  // Fetch comments
  const { rows: comments } = await query(
    `SELECT tc.*, u.first_name || ' ' || u.last_name as author_name, u.avatar_url
     FROM task_comments tc JOIN users u ON tc.user_id = u.id
     WHERE tc.task_id = $1 ORDER BY tc.created_at ASC`,
    [req.params.id]
  );

  // Fetch subtasks
  const { rows: subtasks } = await query(
    `SELECT id, title, status, assignee_id, due_date FROM tasks WHERE parent_task_id = $1`,
    [req.params.id]
  );

  return successResponse(res, { ...rows[0], comments, subtasks });
};

// POST /tasks
const createTask = async (req, res) => {
  const { projectId, title, description, status, priority, assigneeId, dueDate, estimatedHours, tags, parentTaskId } = req.body;
  const tenantId = req.user.tenant_id;

  // Verify project belongs to tenant
  const { rows: projectRows } = await query(
    `SELECT id FROM projects WHERE id = $1 AND tenant_id = $2`, [projectId, tenantId]
  );
  if (!projectRows[0]) return errorResponse(res, 'Project not found', 404);

  const { rows } = await query(
    `INSERT INTO tasks (tenant_id, project_id, title, description, status, priority,
                        assignee_id, reporter_id, due_date, estimated_hours, tags, parent_task_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [tenantId, projectId, title, description, status || 'todo', priority || 'medium',
     assigneeId || null, req.user.id, dueDate || null, estimatedHours || null,
     JSON.stringify(tags || []), parentTaskId || null]
  );

  await logAudit(tenantId, req.user.id, 'task.created', 'task', rows[0].id, { title, projectId }, req.ip);
  await triggerWebhooks(tenantId, 'task.created', rows[0]);

  return successResponse(res, rows[0], 'Task created', 201);
};

// PATCH /tasks/:id
const updateTask = async (req, res) => {
  const { title, description, status, priority, assigneeId, dueDate, estimatedHours, tags, position } = req.body;
  const tenantId = req.user.tenant_id;

  const updates = []; const params = []; let idx = 1;
  if (title !== undefined) { updates.push(`title = $${idx++}`); params.push(title); }
  if (description !== undefined) { updates.push(`description = $${idx++}`); params.push(description); }
  if (status !== undefined) { updates.push(`status = $${idx++}`); params.push(status); }
  if (priority !== undefined) { updates.push(`priority = $${idx++}`); params.push(priority); }
  if (assigneeId !== undefined) { updates.push(`assignee_id = $${idx++}`); params.push(assigneeId); }
  if (dueDate !== undefined) { updates.push(`due_date = $${idx++}`); params.push(dueDate); }
  if (estimatedHours !== undefined) { updates.push(`estimated_hours = $${idx++}`); params.push(estimatedHours); }
  if (tags !== undefined) { updates.push(`tags = $${idx++}`); params.push(JSON.stringify(tags)); }
  if (position !== undefined) { updates.push(`position = $${idx++}`); params.push(position); }

  if (!updates.length) return errorResponse(res, 'Nothing to update', 400);
  updates.push('updated_at = NOW()');
  params.push(req.params.id, tenantId);

  const { rows } = await query(
    `UPDATE tasks SET ${updates.join(', ')} WHERE id = $${idx++} AND tenant_id = $${idx} RETURNING *`,
    params
  );

  if (!rows[0]) return errorResponse(res, 'Task not found', 404);
  await logAudit(tenantId, req.user.id, 'task.updated', 'task', rows[0].id, req.body, req.ip);

  if (req.body.status) await triggerWebhooks(tenantId, 'task.status_changed', rows[0]);

  return successResponse(res, rows[0], 'Task updated');
};

// DELETE /tasks/:id
const deleteTask = async (req, res) => {
  const { rowCount } = await query(
    `DELETE FROM tasks WHERE id = $1 AND tenant_id = $2`, [req.params.id, req.user.tenant_id]
  );
  if (!rowCount) return errorResponse(res, 'Task not found', 404);
  await logAudit(req.user.tenant_id, req.user.id, 'task.deleted', 'task', req.params.id, {}, req.ip);

  return successResponse(res, null, 'Task deleted');
};

// POST /tasks/:id/comments
const addComment = async (req, res) => {
  const { content } = req.body;
  const { rows } = await query(
    `INSERT INTO task_comments (task_id, user_id, content)
     SELECT $1, $2, $3 WHERE EXISTS (SELECT 1 FROM tasks WHERE id = $1 AND tenant_id = $4)
     RETURNING *`,
    [req.params.id, req.user.id, content, req.user.tenant_id]
  );
  if (!rows[0]) return errorResponse(res, 'Task not found', 404);
  return successResponse(res, rows[0], 'Comment added', 201);
};

// DELETE /tasks/:taskId/comments/:commentId
const deleteComment = async (req, res) => {
  const { rowCount } = await query(
    `DELETE FROM task_comments WHERE id = $1 AND task_id = $2 AND user_id = $3`,
    [req.params.commentId, req.params.id, req.user.id]
  );
  if (!rowCount) return errorResponse(res, 'Comment not found', 404);
  return successResponse(res, null, 'Comment deleted');
};

module.exports = { getTasks, getTaskById, createTask, updateTask, deleteTask, addComment, deleteComment };
