import { describe, it, expect, beforeEach } from 'vitest';
import { ApiClient } from '../utils/api-client';
import {
  createTestUser,
  createTestOrganization,
  ensureDefaultRoles,
} from '../utils/database';
import { verifyPassword } from '../../src/core/auth/password';

describe('Authentication Integration Tests', () => {
  let api: ApiClient;

  beforeEach(() => {
    api = new ApiClient();
  });

  describe('POST /api/auth/register', () => {
    it('should register a new user and organization', async () => {
      const registrationData = {
        email: 'newuser@example.com',
        password: 'SecurePass123!',
        name: 'New User',
        organizationName: 'New Organization',
      };

      const response = await api.post('/api/auth/register').send(registrationData);
      
      expect(response.status).toBe(201);
      expect(response.body.accessToken).toBeTruthy();
      expect(response.body.user.email).toBe(registrationData.email);
      expect(response.body.organization.name).toBe(registrationData.organizationName);
    });

    it('should reject duplicate email', async () => {
      const user = await createTestUser({ email: 'existing@example.com' });

      const response = await api.post('/api/auth/register').send({
        email: user.email,
        password: 'Password123!',
        organizationName: 'Test Org',
      });
      
      expect(response.status).toBe(400);
      expect(response.body.error).toContain('already exists');
    });

    it('should require all required fields', async () => {
      const response = await api.post('/api/auth/register').send({
        email: 'test@example.com',
        // Missing password and organizationName
      });
      
      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/auth/login', () => {
    it('should login with correct credentials', async () => {
      const password = 'SecurePass123!';
      const user = await createTestUser({ 
        email: 'login@example.com',
        password,
      });
      const org = await createTestOrganization();
      await ensureDefaultRoles(org.id);
      
      // Create membership
      const { createTestMembership } = await import('../utils/database');
      await createTestMembership(user.id, org.id, { roleKeys: ['owner'] });

      const response = await api.post('/api/auth/login').send({
        email: user.email,
        password,
        organizationSlug: org.slug,
      });
      
      expect(response.status).toBe(200);
      expect(response.body.accessToken).toBeTruthy();
      expect(response.body.user.id).toBe(user.id);
      expect(response.body.organization.id).toBe(org.id);
    });

    it('should reject incorrect password', async () => {
      const user = await createTestUser({ 
        email: 'user@example.com',
        password: 'CorrectPass123!',
      });
      const org = await createTestOrganization();
      await ensureDefaultRoles(org.id);
      const { createTestMembership } = await import('../utils/database');
      await createTestMembership(user.id, org.id, { roleKeys: ['member'] });

      const response = await api.post('/api/auth/login').send({
        email: user.email,
        password: 'WrongPassword123!',
        organizationSlug: org.slug,
      });
      
      expect(response.status).toBe(401);
    });

    it('should reject non-existent user', async () => {
      const response = await api.post('/api/auth/login').send({
        email: 'nonexistent@example.com',
        password: 'Password123!',
        organizationSlug: 'test-org',
      });
      
      expect(response.status).toBe(401);
    });
  });
});

