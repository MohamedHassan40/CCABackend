// Error tracking setup (Sentry integration)
// This file sets up error tracking for production

let errorTracker: {
  captureException: (error: Error, context?: any) => void;
  captureMessage: (message: string, level?: string) => void;
  setUser: (user: { id: string; email?: string }) => void;
} | null = null;

// Initialize error tracking
export function initErrorTracking() {
  const dsn = process.env.SENTRY_DSN;
  
  if (!dsn) {
    console.warn('SENTRY_DSN not configured. Error tracking disabled.');
    return;
  }

  try {
    // Dynamic import to avoid requiring Sentry in development
    const Sentry = require('@sentry/node');
    
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || 'development',
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
      beforeSend(event) {
        // Don't send errors in development
        if (process.env.NODE_ENV === 'development') {
          return null;
        }
        return event;
      },
    });

    errorTracker = {
      captureException: (error: Error, context?: any) => {
        if (context) {
          Sentry.withScope((scope: any) => {
            Object.keys(context).forEach(key => {
              scope.setContext(key, context[key]);
            });
            Sentry.captureException(error);
          });
        } else {
          Sentry.captureException(error);
        }
      },
      captureMessage: (message: string, level: string = 'info') => {
        Sentry.captureMessage(message, level);
      },
      setUser: (user: { id: string; email?: string }) => {
        Sentry.setUser(user);
      },
    };

    console.log('Error tracking initialized (Sentry)');
  } catch (error) {
    console.error('Failed to initialize error tracking:', error);
  }
}

// Capture exception
export function captureException(error: Error, context?: any) {
  if (errorTracker) {
    errorTracker.captureException(error, context);
  } else {
    console.error('Error (tracking not initialized):', error, context);
  }
}

// Capture message
export function captureMessage(message: string, level: string = 'info') {
  if (errorTracker) {
    errorTracker.captureMessage(message, level);
  } else {
    console.log(`[${level.toUpperCase()}] ${message}`);
  }
}

// Set user context
export function setUser(user: { id: string; email?: string }) {
  if (errorTracker) {
    errorTracker.setUser(user);
  }
}

// Error tracking middleware
export function errorTrackingMiddleware(err: Error, req: any, res: any, next: any) {
  captureException(err, {
    request: {
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: req.body,
      user: req.user ? { id: req.user.id, email: req.user.email } : null,
      org: req.org ? { id: req.org.id, name: req.org.name } : null,
    },
  });
  next(err);
}






