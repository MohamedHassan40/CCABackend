import { Request } from 'express';
import type { JWTPayload } from '@cloud-org/shared';

/**
 * Create a mock Express request with user and org
 */
export function createMockRequest(overrides?: Partial<Request>): Partial<Request> {
  return {
    headers: {},
    body: {},
    params: {},
    query: {},
    ...overrides,
  } as Partial<Request>;
}

/**
 * Create a mock request with authentication
 */
export function createAuthenticatedRequest(
  userId: string,
  organizationId: string,
  overrides?: Partial<Request>
): Partial<Request> {
  const payload: JWTPayload = {
    sub: userId,
    orgId: organizationId,
    type: 'access',
  };

  return createMockRequest({
    user: {
      id: userId,
      email: 'test@example.com',
      isSuperAdmin: false,
    },
    org: {
      id: organizationId,
      name: 'Test Org',
      slug: 'test-org',
    },
    jwtPayload: payload,
    ...overrides,
  });
}

/**
 * Sleep helper for async operations
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}













