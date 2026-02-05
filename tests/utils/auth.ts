import { signToken } from '../../src/core/auth/jwt';
import type { JWTPayload } from '@cloud-org/shared';

/**
 * Create an authentication token for a user in an organization
 */
export function createAuthToken(userId: string, organizationId: string): string {
  const payload: JWTPayload = {
    sub: userId,
    orgId: organizationId,
    type: 'access',
  };
  
  return signToken(payload);
}

/**
 * Create an authorization header with token
 */
export function createAuthHeader(userId: string, organizationId: string): { Authorization: string } {
  const token = createAuthToken(userId, organizationId);
  return { Authorization: `Bearer ${token}` };
}













