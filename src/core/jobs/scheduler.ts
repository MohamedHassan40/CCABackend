// Job scheduler using node-cron
// Runs scheduled tasks for subscription renewal, trial expiry, etc.

import cron from 'node-cron';
import { checkAndRenewSubscriptions } from './subscription-renewal';
import { checkAndProcessTrials } from './trial-expiry';
import { checkModuleAccessExpiry } from './module-access-expiry';
import { checkTicketingSlaAlerts } from './ticketing-sla';
import { runMembershipMaintenanceJobs } from './membership-expiry';
import { runPmoBudgetAlertJobs } from './pmo-budget-alerts';
import { captureMessage } from '../errorTracking';

let isRunning = false;

/**
 * Initialize and start all scheduled jobs
 */
export function startScheduledJobs(): void {
  console.log('Starting scheduled jobs...');

  // Run subscription renewal check daily at 2 AM
  cron.schedule('0 2 * * *', async () => {
    if (isRunning) {
      console.log('Previous job still running, skipping...');
      return;
    }

    isRunning = true;
    try {
      console.log('Running subscription renewal check...');
      const results = await checkAndRenewSubscriptions();
      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;
      
      console.log(`Subscription renewal: ${successCount} succeeded, ${failCount} failed`);
      
      if (failCount > 0) {
        captureMessage(`Subscription renewal: ${failCount} failures`, 'warning');
      }
    } catch (error: any) {
      console.error('Error in subscription renewal job:', error);
      captureMessage(`Subscription renewal job failed: ${error.message}`, 'error');
    } finally {
      isRunning = false;
    }
  });

  // Run trial expiry check daily at 3 AM
  cron.schedule('0 3 * * *', async () => {
    try {
      console.log('Running trial expiry check...');
      const result = await checkAndProcessTrials();
      
      console.log(`Trial expiry: ${result.processed} processed, ${result.expired} expired, ${result.notified} notified, ${result.errors} errors`);
      
      if (result.errors > 0) {
        captureMessage(`Trial expiry: ${result.errors} errors`, 'warning');
      }
    } catch (error: any) {
      console.error('Error in trial expiry job:', error);
      captureMessage(`Trial expiry job failed: ${error.message}`, 'error');
    }
  });

  // Dated module access (expiresAt) reminders daily at 3:30 AM
  cron.schedule('30 3 * * *', async () => {
    try {
      console.log('Running module access expiry check...');
      const result = await checkModuleAccessExpiry();
      console.log(
        `Module access expiry: ${result.processed} processed, ${result.notified} notified, ${result.disabled} disabled, ${result.errors} errors`
      );
      if (result.errors > 0) {
        captureMessage(`Module access expiry: ${result.errors} errors`, 'warning');
      }
    } catch (error: any) {
      console.error('Error in module access expiry job:', error);
      captureMessage(`Module access expiry job failed: ${error.message}`, 'error');
    }
  });

  // Ticketing SLA alerts every hour
  cron.schedule('0 * * * *', async () => {
    try {
      const result = await checkTicketingSlaAlerts();
      if (result.notified > 0) {
        console.log(`Ticketing SLA: ${result.processed} checked, ${result.notified} notified`);
      }
    } catch (error: any) {
      console.error('Error in ticketing SLA job:', error);
      captureMessage(`Ticketing SLA job failed: ${error.message}`, 'error');
    }
  });

  // Membership expiry + renewal reminders daily at 4 AM
  cron.schedule('0 4 * * *', async () => {
    try {
      const result = await runMembershipMaintenanceJobs();
      console.log(
        `Membership maintenance: ${result.expiredUpdated} expired, ${result.orgsNotified} orgs notified`
      );
    } catch (error: any) {
      console.error('Error in membership maintenance job:', error);
      captureMessage(`Membership maintenance job failed: ${error.message}`, 'error');
    }
  });

  // PMO budget alerts daily at 5 AM
  cron.schedule('0 5 * * *', async () => {
    try {
      const result = await runPmoBudgetAlertJobs();
      console.log(`PMO budget alerts: ${result.alerted} projects alerted`);
    } catch (error: any) {
      console.error('Error in PMO budget alert job:', error);
      captureMessage(`PMO budget alert job failed: ${error.message}`, 'error');
    }
  });

  console.log('Scheduled jobs started');
}

/**
 * Stop all scheduled jobs
 */
export function stopScheduledJobs(): void {
  // node-cron doesn't have a direct stop method, but we can track jobs
  console.log('Stopping scheduled jobs...');
  // Jobs will stop when process exits
}






