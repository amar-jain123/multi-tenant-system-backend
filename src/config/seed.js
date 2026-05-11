require('dotenv').config();
const bcrypt = require('bcryptjs');
const { connectDB, query } = require('./database');
const logger = require('../utils/logger');

async function seed() {
  await connectDB();
  logger.info('🌱 Seeding database...');

  // Create demo tenant
  const { rows: [tenant] } = await query(
    `INSERT INTO tenants (name, slug, plan) VALUES ('Acme Corp', 'acme-corp', 'pro')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING *`
  );
  logger.info(`Tenant: ${tenant.name} (${tenant.id})`);

  // Create admin user
  const passwordHash = await bcrypt.hash('Admin123!', 12);
  const { rows: [admin] } = await query(
    `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role, email_verified)
     VALUES ($1, 'admin@acme.com', $2, 'Alice', 'Admin', 'admin', true)
     ON CONFLICT (tenant_id, email) DO UPDATE SET password_hash = EXCLUDED.password_hash RETURNING *`,
    [tenant.id, passwordHash]
  );

  // Create member users
  const memberHash = await bcrypt.hash('Member123!', 12);
  const { rows: [member] } = await query(
    `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role, email_verified)
     VALUES ($1, 'dev@acme.com', $2, 'Bob', 'Developer', 'member', true)
     ON CONFLICT (tenant_id, email) DO UPDATE SET first_name = EXCLUDED.first_name RETURNING *`,
    [tenant.id, memberHash]
  );

  // Create sample project
  const { rows: [project] } = await query(
    `INSERT INTO projects (tenant_id, name, description, owner_id)
     VALUES ($1, 'Website Redesign', 'Complete overhaul of company website', $2)
     ON CONFLICT DO NOTHING RETURNING *`,
    [tenant.id, admin.id]
  );

  if (project) {
    // Add member to project
    await query(
      `INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'lead'), ($1, $3, 'member')
       ON CONFLICT DO NOTHING`,
      [project.id, admin.id, member.id]
    );

    // Create sample tasks
    const tasks = [
      { title: 'Design new homepage mockup', status: 'done', priority: 'high' },
      { title: 'Implement responsive navigation', status: 'in_progress', priority: 'high' },
      { title: 'Optimize images and assets', status: 'todo', priority: 'medium' },
      { title: 'Write unit tests for components', status: 'todo', priority: 'low' },
      { title: 'Set up CI/CD pipeline', status: 'in_review', priority: 'urgent' },
    ];

    for (const task of tasks) {
      await query(
        `INSERT INTO tasks (tenant_id, project_id, title, status, priority, reporter_id, assignee_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
        [tenant.id, project.id, task.title, task.status, task.priority, admin.id, member.id]
      );
    }
    logger.info(`Created ${tasks.length} sample tasks`);
  }

  logger.info('✅ Seed complete!');
  logger.info('\n📋 Login credentials:');
  logger.info('  Admin: admin@acme.com / Admin123!');
  logger.info('  Member: dev@acme.com / Member123!');
  process.exit(0);
}

seed().catch((err) => {
  logger.error('❌ Seed failed:', err);
  process.exit(1);
});
