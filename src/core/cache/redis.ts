// Redis caching setup
// This file provides a Redis client for caching

let redisClient: any = null;

export async function initRedis() {
  const REDIS_URL = process.env.REDIS_URL;
  
  if (!REDIS_URL) {
    console.warn('REDIS_URL not configured. Caching disabled.');
    return null;
  }

  try {
    const redis = require('redis');
    redisClient = redis.createClient({
      url: REDIS_URL,
    });

    redisClient.on('error', (err: Error) => {
      console.error('Redis Client Error:', err);
    });

    await redisClient.connect();
    console.log('Redis connected successfully');
    return redisClient;
  } catch (error) {
    console.error('Failed to connect to Redis:', error);
    return null;
  }
}

export function getRedisClient() {
  return redisClient;
}

// Cache helper functions
export async function getCache(key: string): Promise<any | null> {
  if (!redisClient) return null;
  
  try {
    const value = await redisClient.get(key);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    console.error('Redis get error:', error);
    return null;
  }
}

export async function setCache(key: string, value: any, ttlSeconds?: number): Promise<void> {
  if (!redisClient) return;
  
  try {
    const stringValue = JSON.stringify(value);
    if (ttlSeconds) {
      await redisClient.setEx(key, ttlSeconds, stringValue);
    } else {
      await redisClient.set(key, stringValue);
    }
  } catch (error) {
    console.error('Redis set error:', error);
  }
}

export async function deleteCache(key: string): Promise<void> {
  if (!redisClient) return;
  
  try {
    await redisClient.del(key);
  } catch (error) {
    console.error('Redis delete error:', error);
  }
}

export async function clearCache(pattern: string): Promise<void> {
  if (!redisClient) return;
  
  try {
    const keys = await redisClient.keys(pattern);
    if (keys.length > 0) {
      await redisClient.del(keys);
    }
  } catch (error) {
    console.error('Redis clear error:', error);
  }
}






