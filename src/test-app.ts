/**
 * Test version of the Express app without starting the server
 * This is used for testing purposes
 */
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
import { registerHrModule } from './modules/hr';
import { registerTicketingModule } from './modules/ticketing';
import { registerBillingModule } from './modules/billing';
import { registerMarketplaceModule } from './modules/marketplace';
import { securityHeaders } from './middleware/security';

// Create app without starting server
// This file exports the Express app for testing purposes
// It's similar to server.ts but doesn't start the server
const app = express();

// Security middleware (skip rate limiting in tests)
app.use(securityHeaders);

// Middleware
app.use(cors({
  origin: config.corsOrigin,
  credentials: true,
}));
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/me', meRoutes);
app.use('/api/super-admin', superAdminRoutes);
app.use('/api/organizations', organizationRoutes);
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
app.use(mainRouter);

// Error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

export default app;

