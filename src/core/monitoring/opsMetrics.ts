import type { EmailBrandConfig } from '../auth/magicLink';

export interface WebhookMetricEvent {
  type: 'membership_payment' | 'subscription_payment';
  status: 'success' | 'failed' | 'ignored';
  invoiceId?: string;
  error?: string;
  at: string;
}

export interface EmailQueueMetricEvent {
  status: 'sent' | 'failed' | 'retry';
  to: string;
  subject: string;
  error?: string;
  at: string;
}

const MAX_EVENTS = 200;
const webhookEvents: WebhookMetricEvent[] = [];
const emailEvents: EmailQueueMetricEvent[] = [];

export function recordWebhookMetric(event: Omit<WebhookMetricEvent, 'at'>): void {
  webhookEvents.unshift({ ...event, at: new Date().toISOString() });
  if (webhookEvents.length > MAX_EVENTS) webhookEvents.length = MAX_EVENTS;
  if (event.status === 'failed') {
    void import('../errorTracking').then(({ captureMessage }) => {
      captureMessage(`Webhook ${event.type} failed: ${event.error ?? 'unknown'}`, 'error');
    });
  }
}

export function recordEmailQueueMetric(event: Omit<EmailQueueMetricEvent, 'at'>): void {
  emailEvents.unshift({ ...event, at: new Date().toISOString() });
  if (emailEvents.length > MAX_EVENTS) emailEvents.length = MAX_EVENTS;
  if (event.status === 'failed') {
    void import('../errorTracking').then(({ captureMessage }) => {
      captureMessage(`Email queue failed to ${event.to}: ${event.error ?? 'unknown'}`, 'warning');
    });
  }
}

export function getMonitoringSnapshot(): {
  webhooks: { recent: WebhookMetricEvent[]; failedLast24h: number };
  emailQueue: { recent: EmailQueueMetricEvent[]; failedLast24h: number };
} {
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const failedWebhooks = webhookEvents.filter(
    (e) => e.status === 'failed' && new Date(e.at).getTime() >= dayAgo
  ).length;
  const failedEmails = emailEvents.filter(
    (e) => e.status === 'failed' && new Date(e.at).getTime() >= dayAgo
  ).length;
  return {
    webhooks: { recent: webhookEvents.slice(0, 30), failedLast24h: failedWebhooks },
    emailQueue: { recent: emailEvents.slice(0, 30), failedLast24h: failedEmails },
  };
}

export type { EmailBrandConfig };
