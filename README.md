# 🚀 Multi-Tenant SaaS API Platform

A production-ready REST API backend for a SaaS project management platform, built with **Node.js**, **Express**, **PostgreSQL**, and **Redis**. Features multi-tenancy, JWT authentication with refresh token rotation, role-based access control, Redis caching, webhook delivery, API key management, audit logging, and full Swagger documentation.

## ✨ Features

| Feature | Details |
|---|---|
| **Multi-Tenancy** | Full tenant isolation — each org's data is siloed |
| **JWT Auth** | Access tokens (15m) + Refresh token rotation (7d) |
| **RBAC** | 4 roles: `admin`, `manager`, `member`, `viewer` |
| **Redis Caching** | Tenant resolution, project data cached |
| **Token Blacklisting** | Logout invalidates tokens via Redis |
| **API Keys** | Scoped API keys with expiry support |
| **Webhooks** | Event-driven delivery with HMAC signatures |
| **Audit Logs** | Full audit trail for all mutations |
| **Rate Limiting** | Global + per-route (auth-specific limits) |
| **Swagger Docs** | Auto-generated at `/api-docs` |
| **Docker** | Full Docker + docker-compose setup |
| **Tests** | Jest + Supertest with mocked infrastructure |

## 🏗️ Architecture

```
src/
├── config/
│   ├── database.js      # PostgreSQL pool with transaction helper
│   ├── redis.js         # Redis client + cache helpers
│   ├── swagger.js       # OpenAPI 3.0 spec
│   ├── migrate.js       # DB schema migrations
│   └── seed.js          # Demo data seeder
├── controllers/
│   ├── auth.controller.js    # Register, login, refresh, logout
│   ├── user.controller.js    # User CRUD with tenant isolation
│   ├── project.controller.js # Project + member management
│   ├── task.controller.js    # Tasks, subtasks, comments
│   ├── tenant.controller.js  # Org settings, stats, audit logs
│   ├── webhook.controller.js # Webhook CRUD + delivery history
│   └── apiKey.controller.js  # API key lifecycle
├── middleware/
│   ├── auth.js           # JWT & API key authentication, RBAC
│   ├── tenantResolver.js # Resolves tenant from header/subdomain
│   ├── rateLimiter.js    # Express-rate-limit configs
│   ├── errorHandler.js   # Global error handler + AppError class
│   └── validate.js       # express-validator helper
├── routes/               # Express routers
├── services/
│   └── webhook.service.js # Async webhook delivery + retry logic
└── utils/
    ├── jwt.js     # Token generation, verification, hashing
    ├── response.js # Standardized API response helpers
    ├── logger.js  # Winston structured logging
    └── audit.js   # Audit log writer
```

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL 14+
- Redis 6+

### Option 1: Docker (Recommended)
```bash
git clone <repo>
cd saas-api
docker-compose up -d
docker-compose exec api npm run migrate
docker-compose exec api npm run seed
```

### Option 2: Local
```bash
npm install
cp .env.example .env
# Edit .env with your DB/Redis credentials
npm run migrate
npm run seed
npm run dev
```

API available at: `http://localhost:3000`
Swagger docs: `http://localhost:3000/api-docs`

## 🔐 Authentication

### Register
```bash
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@mycompany.com",
    "password": "SecurePass123!",
    "firstName": "Jane",
    "lastName": "Doe",
    "tenantName": "My Company"
  }'
```

### Login
```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@acme.com", "password": "Admin123!"}'
```

Use the `accessToken` in the `Authorization: Bearer <token>` header for all subsequent requests.

## 📚 API Reference

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/register` | Create org + admin user |
| POST | `/auth/login` | Login and get tokens |
| POST | `/auth/refresh` | Rotate refresh token |
| POST | `/auth/logout` | Blacklist tokens |
| GET | `/auth/me` | Get current user |
| POST | `/auth/change-password` | Update password |

### Users
| Method | Endpoint | Auth Required |
|--------|----------|---------------|
| GET | `/users` | Any |
| GET | `/users/:id` | Any |
| POST | `/users` | Admin only |
| PATCH | `/users/:id` | Self or Admin |
| DELETE | `/users/:id` | Admin only |

### Projects
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/projects` | List with pagination/search |
| POST | `/projects` | Create project |
| PATCH | `/projects/:id` | Update project |
| DELETE | `/projects/:id` | Delete project |
| POST | `/projects/:id/members` | Add member |
| DELETE | `/projects/:id/members/:userId` | Remove member |

### Tasks
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/tasks` | Filter by project/status/priority/assignee |
| POST | `/tasks` | Create task |
| PATCH | `/tasks/:id` | Update task |
| DELETE | `/tasks/:id` | Delete task |
| POST | `/tasks/:id/comments` | Add comment |
| DELETE | `/tasks/:id/comments/:commentId` | Delete comment |

### Webhooks
```
GET    /webhooks
POST   /webhooks         { url, events: ["task.created", "task.status_changed", "project.created"] }
PATCH  /webhooks/:id
DELETE /webhooks/:id
GET    /webhooks/:id/deliveries
```

### API Keys
```
GET    /api-keys
POST   /api-keys         { name, scopes, expiresAt }
PATCH  /api-keys/:id
DELETE /api-keys/:id
```

## 🏠 Multi-Tenancy

Tenant resolution order:
1. `X-Tenant-ID` header (UUID or slug)
2. Subdomain: `acme.saasplatform.com`
3. JWT user's `tenant_id`

All data queries are automatically scoped to the authenticated tenant.

## 🧪 Testing

```bash
npm test           # Run all tests with coverage
npm test -- --watch  # Watch mode
```
