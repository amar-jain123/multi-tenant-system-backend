const { query, withTransaction } = require('../config/database');
const { successResponse, errorResponse, paginatedResponse, getPagination, buildPaginationMeta } = require('../utils/response');
const { deleteCache, deleteCachePattern, setCache, getCache } = require('../config/redis');
const { logAudit } = require('../utils/audit');
const { triggerWebhooks } = require('../services/webhook.service');

// GET /projects
const getProjects = async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const { search, status } = req.query;
  const tenantId = req.user.tenant_id;

  let conditions = ['p.tenant_id = $1'];
  let params = [tenantId];
  let idx = 2;

  // Non-admins see only their projects
  if (!['admin', 'manager'].includes(req.user.role)) {
    conditions.push(`(p.owner_id = $${idx} OR pm.user_id = $${idx})`);
    params.push(req.user.id);
    idx++;
  }
  if (search) { conditions.push(`p.name ILIKE $${idx++}`); params.push(`%${search}%`); }
  if (status) { conditions.push(`p.status = $${idx++}`); params.push(status); }

  const where = conditions.join(' AND ');
  const joinClause = !['admin', 'manager'].includes(req.user.role)
    ? 'LEFT JOIN project_members pm ON p.id = pm.project_id' : '';

  const { rows: countRows } = await query(
    `SELECT COUNT(DISTINCT p.id) FROM projects p ${joinClause} WHERE ${where}`, params
  );

  const { rows } = await query(
    `SELECT DISTINCT p.*, u.first_name || ' ' || u.last_name as owner_name,
            (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status != 'cancelled') as task_count
     FROM projects p ${joinClause}
     JOIN users u ON p.owner_id = u.id
     WHERE ${where} ORDER BY p.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, limit, offset]
  );

  return paginatedResponse(res, rows, buildPaginationMeta(parseInt(countRows[0].count), page, limit));
};

// GET /projects/:id
const getProjectById = async (req, res) => {
  const cacheKey = `project:${req.params.id}`;
  let project = await getCache(cacheKey);

  if (!project) {
    const { rows } = await query(
      `SELECT p.*, u.first_name || ' ' || u.last_name as owner_name,
              u.email as owner_email,
              (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) as total_tasks,
              (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') as completed_tasks
       FROM projects p JOIN users u ON p.owner_id = u.id
       WHERE p.id = $1 AND p.tenant_id = $2`,
      [req.params.id, req.user.tenant_id]
    );
    if (!rows[0]) return errorResponse(res, 'Project not found', 404);

    // Fetch members
    const { rows: members } = await query(
      `SELECT pm.role, pm.joined_at, u.id, u.email, u.first_name, u.last_name, u.avatar_url
       FROM project_members pm JOIN users u ON pm.user_id = u.id
       WHERE pm.project_id = $1`,
      [req.params.id]
    );

    project = { ...rows[0], members };
    await setCache(cacheKey, project, 60);
  }

  return successResponse(res, project);
};

// POST /projects
const createProject = async (req, res) => {
  const { name, description, memberIds = [] } = req.body;
  const tenantId = req.user.tenant_id;

  const result = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO projects (tenant_id, name, description, owner_id) VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [tenantId, name, description, req.user.id]
    );
    const project = rows[0];

    // Add owner as lead member
    await client.query(
      `INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'lead')`,
      [project.id, req.user.id]
    );

    // Add other members
    for (const userId of memberIds) {
      if (userId !== req.user.id) {
        await client.query(
          `INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'member')
           ON CONFLICT DO NOTHING`,
          [project.id, userId]
        );
      }
    }

    return project;
  });

  await logAudit(tenantId, req.user.id, 'project.created', 'project', result.id, { name }, req.ip);
  await triggerWebhooks(tenantId, 'project.created', result);

  return successResponse(res, result, 'Project created', 201);
};

// PATCH /projects/:id
const updateProject = async (req, res) => {
  const { name, description, status } = req.body;
  const tenantId = req.user.tenant_id;

  const updates = []; const params = []; let idx = 1;
  if (name !== undefined) { updates.push(`name = $${idx++}`); params.push(name); }
  if (description !== undefined) { updates.push(`description = $${idx++}`); params.push(description); }
  if (status !== undefined) { updates.push(`status = $${idx++}`); params.push(status); }

  if (!updates.length) return errorResponse(res, 'Nothing to update', 400);
  updates.push(`updated_at = NOW()`);
  params.push(req.params.id, tenantId);

  const { rows } = await query(
    `UPDATE projects SET ${updates.join(', ')} WHERE id = $${idx++} AND tenant_id = $${idx}
     RETURNING *`,
    params
  );

  if (!rows[0]) return errorResponse(res, 'Project not found', 404);
  await deleteCache(`project:${req.params.id}`);
  await logAudit(tenantId, req.user.id, 'project.updated', 'project', rows[0].id, req.body, req.ip);

  return successResponse(res, rows[0], 'Project updated');
};

// DELETE /projects/:id
const deleteProject = async (req, res) => {
  const { rowCount } = await query(
    `DELETE FROM projects WHERE id = $1 AND tenant_id = $2`,
    [req.params.id, req.user.tenant_id]
  );
  if (!rowCount) return errorResponse(res, 'Project not found', 404);

  await deleteCache(`project:${req.params.id}`);
  await logAudit(req.user.tenant_id, req.user.id, 'project.deleted', 'project', req.params.id, {}, req.ip);

  return successResponse(res, null, 'Project deleted');
};

// POST /projects/:id/members
const addMember = async (req, res) => {
  const { userId, role = 'member' } = req.body;

  const { rows } = await query(
    `INSERT INTO project_members (project_id, user_id, role)
     SELECT $1, $2, $3 WHERE EXISTS (
       SELECT 1 FROM users WHERE id = $2 AND tenant_id = $4
     ) RETURNING *`,
    [req.params.id, userId, role, req.user.tenant_id]
  );

  if (!rows[0]) return errorResponse(res, 'User not found in your organization', 404);
  await deleteCache(`project:${req.params.id}`);

  return successResponse(res, rows[0], 'Member added', 201);
};

// DELETE /projects/:id/members/:userId
const removeMember = async (req, res) => {
  await query(
    `DELETE FROM project_members WHERE project_id = $1 AND user_id = $2`,
    [req.params.id, req.params.userId]
  );
  await deleteCache(`project:${req.params.id}`);

  return successResponse(res, null, 'Member removed');
};

module.exports = { getProjects, getProjectById, createProject, updateProject, deleteProject, addMember, removeMember };
