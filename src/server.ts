import express from 'express';
import cors from 'cors';
import { config } from './core/config';
import authRoutes from './routes/auth';
import meRoutes from './routes/me';
import superAdminRoutes from './routes/super-admin';
import organizationRoutes from './routes/organizations';
import publicRoutes from './routes/public';
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
import { registerMarketplaceModule } from './modules/marketplace';
import { registerPmoModule } from './modules/pmo';
import { registerDocumentsModule } from './modules/documents';
import { registerSalesModule } from './modules/sales';
import { registerMembershipModule } from './modules/membership';
import { securityHeaders, apiRateLimiter, helmetConfig } from './middleware/security';
import { csrfProtection, setCsrfToken } from './middleware/csrf';
import { verifyMoyasarWebhook, webhookIdempotency, logWebhookEvent } from './middleware/webhook-security';
import { initErrorTracking, errorTrackingMiddleware } from './core/errorTracking';
import { startScheduledJobs } from './core/jobs/scheduler';
import prisma from './core/db';

// Initialize error tracking
initErrorTracking();

const app = express();

// Trust proxy - required for rate limiting behind reverse proxy (Railway, etc.)
app.set('trust proxy', true);

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
app.use('/api/super-admin', superAdminRoutes);
app.use('/api/organizations', organizationRoutes);
app.use('/api/onboarding', onboardingRoutes);
app.use('/api/public', publicRoutes);
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
registerBillingModule(mainRouter);
registerMarketplaceModule(mainRouter);
registerPmoModule(mainRouter);
registerDocumentsModule(mainRouter);
registerSalesModule(mainRouter);
registerMembershipModule(mainRouter);
app.use(mainRouter);

// Payment callback webhook (no auth required - Moyasar calls this)
app.post('/api/billing/payment-callback', 
  logWebhookEvent,
  webhookIdempotency,
  verifyMoyasarWebhook,
  async (req, res) => {
  try {
    const { id: invoiceId, status, amount, metadata } = req.body;

    if (!invoiceId || !status) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    const { moyasarService } = await import('./core/payments/moyasar');
    const invoice = await moyasarService.getInvoiceById(invoiceId);

    if (invoice.status !== 'paid') {
      res.json({ received: true, message: 'Payment not completed yet' });
      return;
    }

    // Extract metadata
    const orgId = metadata?.organizationId || invoice.metadata?.organizationId;
    const moduleId = metadata?.moduleId || invoice.metadata?.moduleId;
    const plan = metadata?.plan || invoice.metadata?.plan;
    const billingPeriod = metadata?.billingPeriod || invoice.metadata?.billingPeriod || 'monthly';

    if (!orgId || !moduleId) {
      console.error('Missing organizationId or moduleId in payment callback');
      res.status(400).json({ error: 'Missing organization or module information' });
      return;
    }

    // Find the payment record
    const payment = await prisma.payment.findFirst({
      where: {
        providerRef: invoiceId,
        provider: 'moyasar',
      },
    });

    if (payment) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'succeeded' },
      });
    }

    // Calculate billing period end date
    const now = new Date();
    const currentPeriodEnd = new Date(now);
    if (billingPeriod === 'monthly') {
      currentPeriodEnd.setMonth(currentPeriodEnd.getMonth() + 1);
    } else {
      currentPeriodEnd.setFullYear(currentPeriodEnd.getFullYear() + 1);
    }

    // Find existing subscription
    const existingSubscription = await prisma.subscription.findFirst({
      where: {
        organizationId: orgId,
        moduleId: moduleId,
      },
    });

    // Create or update subscription
    const subscription = existingSubscription
      ? await prisma.subscription.update({
          where: { id: existingSubscription.id },
          data: {
            plan,
            status: 'active',
            currentPeriodStart: now,
            currentPeriodEnd,
            cancelAtPeriodEnd: false,
            canceledAt: null,
          },
        })
      : await prisma.subscription.create({
          data: {
            organizationId: orgId,
            moduleId: moduleId,
            plan,
            status: 'active',
            currentPeriodStart: now,
            currentPeriodEnd,
          },
        });

    // Update OrgModule
    // For active subscriptions, expiresAt should be null (no expiration)
    // The subscription tracks the billing period, module stays active until canceled
    await prisma.orgModule.upsert({
      where: {
        organizationId_moduleId: {
          organizationId: orgId,
          moduleId: moduleId,
        },
      },
      update: {
        isEnabled: true,
        plan,
        expiresAt: null, // No expiration for active subscriptions
        trialEndsAt: null,
      },
      create: {
        organizationId: orgId,
        moduleId: moduleId,
        isEnabled: true,
        plan,
        expiresAt: null, // No expiration for active subscriptions
        trialEndsAt: null,
      },
    });

    // If this is a renewal payment, process it
    if (metadata?.isRenewal === true || invoice.metadata?.isRenewal === true) {
      const { processRenewalPayment } = await import('./core/jobs/subscription-renewal');
      if (payment) {
        await processRenewalPayment(subscription.id, payment.id);
      }
    }

    res.json({ success: true, subscription });
  } catch (error) {
    console.error('Payment callback error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Error handler with tracking
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  errorTrackingMiddleware(err, req, res, next);
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
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


