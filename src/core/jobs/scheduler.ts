// Job scheduler using node-cron
// Runs scheduled tasks for subscription renewal, trial expiry, etc.

import cron from 'node-cron';
import { checkAndRenewSubscriptions } from './subscription-renewal';
import { checkAndProcessTrials } from './trial-expiry';
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






