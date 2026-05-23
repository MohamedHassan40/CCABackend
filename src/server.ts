import express from 'express';
import cors from 'cors';
import { config } from './core/config';
import authRoutes from './routes/auth';
import meRoutes from './routes/me';
import meEmployeePortalRoutes from './routes/meEmployeePortal';
import meActivitiesRoutes from './routes/meActivities';
import meMemberPortalRoutes from './routes/meMemberPortal';
import superAdminRoutes from './routes/super-admin';
import organizationRoutes from './routes/organizations';
import publicRoutes from './routes/public';
import publicMembershipRoutes from './routes/publicMembership';
import publicPmoRoutes from './routes/publicPmo';
import userRoutes from './routes/users';
import notificationRoutes from './routes/notifications';
import auditLogRoutes from './routes/audit-logs';
import fileRoutes from './routes/files';
import searchRoutes from './routes/search';
import analyticsRoutes from './routes/analytics';
import onboardingRoutes from './routes/onboarding';
import { registerHrModule } from './modules/hr';
import { registerTicketingModule } from './modules/ticketing';
import { registerBillingModule } from './modules/billing';
import { registerSubscriptionsModule } from './modules/subscriptions';
import { handleSubscriptionPaymentCallback } from './core/payments/subscription-payment-callback';
import { handleMembershipPaymentCallback } from './core/payments/membership-payment-callback';
import { registerMarketplaceModule } from './modules/marketplace';
import { registerPmoModule } from './modules/pmo';
import { registerDocumentsModule } from './modules/documents';
import { registerSalesModule } from './modules/sales';
import { registerMembershipModule } from './modules/membership';
import { securityHeaders, apiRateLimiter, helmetConfig } from './middleware/security';
import { csrfProtection, setCsrfToken } from './middleware/csrf';
import { verifyMoyasarWebhook, webhookIdempotency, logWebhookEvent } from './middleware/webhook-security';
import { initErrorTracking, errorTrackingMiddleware } from './core/errorTracking';
import { sanitizeApiError } from './core/apiErrors';
import { startScheduledJobs } from './core/jobs/scheduler';
import { getMonitoringSnapshot } from './core/monitoring/opsMetrics';
import prisma from './core/db';

// Initialize error tracking
initErrorTracking();

const app = express();

// Railway/Reverse-proxy deployments send X-Forwarded-* headers.
// Trust first proxy hop so rate-limiter and req.ip work correctly.
app.set('trust proxy', 1);

// Security middleware (apply before other middleware)
if (config.nodeEnv === 'production') {
  app.use(helmetConfig);
}
app.use(securityHeaders);

// CSRF protection (for state-changing requests)
if (config.nodeEnv === 'production') {
  app.use('/api', csrfProtection);
  app.use(setCsrfToken);
}

// Middleware
app.use(cors({
  origin: config.corsOrigin,
  credentials: true,
}));
app.use(express.json());

// Apply rate limiting to API routes
app.use('/api', apiRateLimiter);

// Health check endpoints
app.get('/health', async (req, res) => {
  try {
    // Check database connection
    await prisma.$queryRaw`SELECT 1`;
    
    res.json({ 
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: config.nodeEnv,
      monitoring: getMonitoringSnapshot(),
    });
  } catch (error) {
    res.status(503).json({ 
      status: 'error',
      error: 'Database connection failed',
      timestamp: new Date().toISOString(),
    });
  }
});

// Readiness check (for Kubernetes/Docker)
app.get('/ready', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ready' });
  } catch (error) {
    res.status(503).json({ status: 'not ready' });
  }
});

// Liveness check
app.get('/live', (req, res) => {
  res.json({ status: 'alive' });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/me', meRoutes);
app.use('/api/me', meEmployeePortalRoutes);
app.use('/api/me', meActivitiesRoutes);
app.use('/api/me', meMemberPortalRoutes);
app.use('/api/super-admin', superAdminRoutes);
app.use('/api/organizations', organizationRoutes);
app.use('/api/onboarding', onboardingRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/public/membership', publicMembershipRoutes);
app.use('/api/public/pmo', publicPmoRoutes);
app.use('/api/users', userRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/audit-logs', auditLogRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/analytics', analyticsRoutes);

// Register modules
const mainRouter = express.Router();
registerHrModule(mainRouter);
registerTicketingModule(mainRouter);
registerSubscriptionsModule(mainRouter);
registerBillingModule(mainRouter);
registerMarketplaceModule(mainRouter);
registerPmoModule(mainRouter);
registerDocumentsModule(mainRouter);
registerSalesModule(mainRouter);
registerMembershipModule(mainRouter);
app.use(mainRouter);

const subscriptionPaymentCallbackMiddleware = [
  logWebhookEvent,
  webhookIdempotency,
  verifyMoyasarWebhook,
  handleSubscriptionPaymentCallback,
] as const;

// Payment callback webhook (no auth — Moyasar calls this). Legacy path kept for existing integrations.
app.post('/api/billing/payment-callback', ...subscriptionPaymentCallbackMiddleware);
app.post('/api/subscriptions/payment-callback', ...subscriptionPaymentCallbackMiddleware);
app.post('/api/public/membership/payment-callback', ...subscriptionPaymentCallbackMiddleware, handleMembershipPaymentCallback);

// Error handler with tracking and user-friendly messages (no raw DB/stack in response)
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  errorTrackingMiddleware(err, req, res, next);
  console.error('Error:', err);
  res.status(500).json({ error: sanitizeApiError(err) });
});

// Start server
const PORT = config.port;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  
  // Start scheduled jobs (subscription renewal, trial expiry, etc.)
  if (config.nodeEnv === 'production' || process.env.ENABLE_JOBS === 'true') {
    startScheduledJobs();
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});


