/**
 * Multi-tenancy utilities
 * All business entities should include orgId to support multi-tenancy
 */

/**
 * Ensures a query includes orgId filter for multi-tenancy
 */
export function withOrgId<T extends { orgId?: string }>(
  query: T,
  orgId: string
): T & { orgId: string } {
  return {
    ...query,
    orgId,
  };
}
















