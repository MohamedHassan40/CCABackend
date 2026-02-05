# Backend Testing

This directory contains all backend tests for the cloud organization system.

## Quick Start

```bash
# Install dependencies (if not already done)
npm install

# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run specific test file
npm test tests/modules/hr.employees.test.ts

# Generate coverage report
npm run test:coverage
```

## Test Structure

```
tests/
├── setup.ts                 # Global test setup (runs before all tests)
├── utils/                   # Test utilities
│   ├── database.ts          # Database helpers (clean, create test data)
│   ├── auth.ts              # Authentication helpers
│   ├── api-client.ts        # API testing client
│   └── test-helpers.ts      # General utilities
├── unit/                    # Unit tests (test individual functions)
│   └── permissions.test.ts
├── integration/             # Integration tests (test API endpoints)
│   └── auth.test.ts
└── modules/                 # Module-specific tests
    ├── hr.employees.test.ts
    ├── ticketing.test.ts
    ├── billing.test.ts
    └── ...
```

## Writing Tests

### Basic Test Template

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { ApiClient } from '../utils/api-client';
import { createTestUser, createTestOrganization } from '../utils/database';

describe('My Module', () => {
  let api: ApiClient;
  let user: any;
  let org: any;

  beforeEach(async () => {
    // Setup: Create test data
    api = new ApiClient();
    user = await createTestUser();
    org = await createTestOrganization();
    api.setAuth(user.id, org.id);
  });

  it('should do something', async () => {
    const response = await api.get('/api/my-endpoint');
    expect(response.status).toBe(200);
  });
});
```

## Test Utilities

### Database Helpers

```typescript
import {
  createTestUser,
  createTestOrganization,
  createTestMembership,
  createTestModule,
  enableModuleForOrg,
  cleanDatabase, // Usually called automatically
} from '../utils/database';

// Create a test user
const user = await createTestUser({
  email: 'test@example.com',
  password: 'Password123!',
  name: 'Test User',
});

// Create a test organization
const org = await createTestOrganization({
  name: 'Test Org',
  slug: 'test-org',
});

// Create membership
await createTestMembership(user.id, org.id, {
  roleKeys: ['owner'],
});
```

### API Client

```typescript
import { ApiClient } from '../utils/api-client';

const api = new ApiClient();
api.setAuth(userId, organizationId);

// Make authenticated requests
const response = await api.get('/api/endpoint');
const response = await api.post('/api/endpoint').send({ data: 'value' });
const response = await api.put('/api/endpoint/:id').send({ data: 'value' });
const response = await api.delete('/api/endpoint/:id');

// Clear auth
api.clearAuth();
```

### Authentication Helpers

```typescript
import { createAuthToken, createAuthHeader } from '../utils/auth';

// Create a token
const token = createAuthToken(userId, organizationId);

// Create auth header
const header = createAuthHeader(userId, organizationId);
// { Authorization: 'Bearer ...' }
```

## What Gets Tested

Each module test covers:

1. **Authentication**: Is auth required? Does it work?
2. **Authorization**: Do permissions work correctly?
3. **CRUD Operations**: Create, Read, Update, Delete
4. **Validation**: Required fields, invalid data
5. **Edge Cases**: Empty data, missing resources, etc.
6. **Isolation**: Can users access other orgs' data? (Should not)

## Common Patterns

### Testing Module Requirements

```typescript
// Enable module
const module = await createTestModule({ key: 'hr' });
await enableModuleForOrg(org.id, module.id);

// Create permissions
await prisma.permission.create({
  data: {
    key: 'hr.employees.view',
    name: 'View Employees',
    moduleId: module.id,
  },
});

// Assign to role
const role = await prisma.role.findUnique({ where: { key: 'owner' } });
await prisma.rolePermission.create({
  data: {
    roleId: role.id,
    permissionId: permission.id,
  },
});
```

### Testing Errors

```typescript
// Test 400 Bad Request
const response = await api.post('/api/endpoint').send({});
expect(response.status).toBe(400);

// Test 401 Unauthorized
api.clearAuth();
const response = await api.get('/api/endpoint');
expect(response.status).toBe(401);

// Test 403 Forbidden (missing permission)
// Don't assign the required permission
const response = await api.get('/api/endpoint');
expect(response.status).toBe(403);

// Test 404 Not Found
const response = await api.get('/api/endpoint/non-existent-id');
expect(response.status).toBe(404);
```

## Tips

1. **Keep tests isolated**: Each test should work independently
2. **Clean up**: Database is cleaned automatically, but ensure your test data doesn't conflict
3. **Use descriptive names**: `it('should create employee with user account')`
4. **Test both success and failure**: Test what should work and what shouldn't
5. **Check response structure**: Verify the response has the expected fields

## Troubleshooting

### Tests timeout

Increase timeout in `vitest.config.ts`:
```typescript
test: {
  testTimeout: 30000, // 30 seconds
}
```

### Database connection errors

Ensure:
- Database is running
- `DATABASE_URL` is set correctly
- Test database exists (can be same as dev database, tests clean it)

### Permission errors

Make sure you:
- Enable the module for the organization
- Create the required permissions
- Assign permissions to roles
- Assign roles to the user's membership

## Coverage Goals

- **Unit Tests**: 80%+ coverage
- **Integration Tests**: All critical flows
- **Module Tests**: All CRUD operations for each module













