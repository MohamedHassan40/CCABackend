import request from 'supertest';
import { Express } from 'express';
import app from '../../src/test-app';
import { createAuthToken } from './auth';

/**
 * API Client for making authenticated requests in tests
 */
export class ApiClient {
  private token: string | null = null;

  /**
   * Set authentication token
   */
  setAuth(userId: string, organizationId: string): void {
    this.token = createAuthToken(userId, organizationId);
  }

  /**
   * Clear authentication
   */
  clearAuth(): void {
    this.token = null;
  }

  /**
   * Make a GET request
   */
  get(path: string) {
    const req = request(app).get(path);
    if (this.token) {
      req.set('Authorization', `Bearer ${this.token}`);
    }
    return req;
  }

  /**
   * Make a POST request
   */
  post(path: string) {
    const req = request(app).post(path);
    if (this.token) {
      req.set('Authorization', `Bearer ${this.token}`);
    }
    return req;
  }

  /**
   * Make a PUT request
   */
  put(path: string) {
    const req = request(app).put(path);
    if (this.token) {
      req.set('Authorization', `Bearer ${this.token}`);
    }
    return req;
  }

  /**
   * Make a DELETE request
   */
  delete(path: string) {
    const req = request(app).delete(path);
    if (this.token) {
      req.set('Authorization', `Bearer ${this.token}`);
    }
    return req;
  }

  /**
   * Make a PATCH request
   */
  patch(path: string) {
    const req = request(app).patch(path);
    if (this.token) {
      req.set('Authorization', `Bearer ${this.token}`);
    }
    return req;
  }
}

/**
 * Get the test app instance
 */
export function getTestApp(): Express {
  return app;
}

