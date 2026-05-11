const { createClient } = require('redis');
const logger = require('../utils/logger');

let client;

const connectRedis = async () => {
  client = createClient({
    socket: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT) || 6379,
    },
    password: process.env.REDIS_PASSWORD || undefined,
  });

  client.on('error', (err) => logger.error('Redis error:', err));
  client.on('reconnecting', () => logger.warn('Redis reconnecting...'));

  await client.connect();
};

const getRedis = () => {
  if (!client) throw new Error('Redis not initialized');
  return client;
};

// Cache helpers
const setCache = async (key, value, ttlSeconds = 300) => {
  await client.setEx(key, ttlSeconds, JSON.stringify(value));
};

const getCache = async (key) => {
  const data = await client.get(key);
  return data ? JSON.parse(data) : null;
};

const deleteCache = async (key) => {
  await client.del(key);
};

const deleteCachePattern = async (pattern) => {
  const keys = await client.keys(pattern);
  if (keys.length > 0) await client.del(keys);
};

// Token blacklist (for logout)
const blacklistToken = async (token, ttlSeconds) => {
  await client.setEx(`blacklist:${token}`, ttlSeconds, '1');
};

const isTokenBlacklisted = async (token) => {
  const result = await client.get(`blacklist:${token}`);
  return result !== null;
};

module.exports = {
  connectRedis, getRedis,
  setCache, getCache, deleteCache, deleteCachePattern,
  blacklistToken, isTokenBlacklisted,
};
