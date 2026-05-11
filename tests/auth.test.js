const request = require('supertest');
const app = require('../src/app');

// Mock DB and Redis for testing
jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  withTransaction: jest.fn((cb) => cb({ query: jest.fn().mockResolvedValue({ rows: [{}] }) })),
  connectDB: jest.fn(),
}));

jest.mock('../src/config/redis', () => ({
  connectRedis: jest.fn(),
  isTokenBlacklisted: jest.fn().mockResolvedValue(false),
  blacklistToken: jest.fn(),
  setCache: jest.fn(),
  getCache: jest.fn().mockResolvedValue(null),
  deleteCache: jest.fn(),
}));

jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn() }));

const { query } = require('../src/config/database');

describe('Auth Endpoints', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('POST /api/v1/auth/register', () => {
    it('should return 422 for invalid email', async () => {
      const res = await request(app).post('/api/v1/auth/register').send({
        email: 'invalid-email',
        password: 'password123',
        firstName: 'John',
        lastName: 'Doe',
        tenantName: 'Acme Corp',
      });
      expect(res.status).toBe(422);
    });

    it('should return 422 for short password', async () => {
      const res = await request(app).post('/api/v1/auth/register').send({
        email: 'john@example.com',
        password: '123',
        firstName: 'John',
        lastName: 'Doe',
        tenantName: 'Acme Corp',
      });
      expect(res.status).toBe(422);
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('should return 422 for missing credentials', async () => {
      const res = await request(app).post('/api/v1/auth/login').send({});
      expect(res.status).toBe(422);
    });

    it('should return 401 for invalid credentials', async () => {
      query.mockResolvedValueOnce({ rows: [] });
      const res = await request(app).post('/api/v1/auth/login').send({
        email: 'john@example.com',
        password: 'wrongpassword',
      });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/auth/me', () => {
    it('should return 401 without token', async () => {
      const res = await request(app).get('/api/v1/auth/me');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    it('should return 422 without refresh token', async () => {
      const res = await request(app).post('/api/v1/auth/refresh').send({});
      expect(res.status).toBe(422);
    });
  });
});

describe('Health Check', () => {
  it('GET /health should return 200', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
  });
});

describe('404 Handler', () => {
  it('should return 404 for unknown routes', async () => {
    const res = await request(app).get('/api/v1/unknown');
    expect(res.status).toBe(404);
  });
});
