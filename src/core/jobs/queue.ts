// Bull/BullMQ queue setup for background jobs
// This file sets up a job queue for processing background tasks

import { Queue, Worker, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';

let connection: IORedis | null = null;
let emailQueue: Queue | null = null;
let emailWorker: Worker | null = null;

export async function initJobQueue() {
  const REDIS_URL = process.env.REDIS_URL;
  
  if (!REDIS_URL) {
    console.warn('REDIS_URL not configured. Job queue disabled. Using in-memory queue.');
    return null;
  }

  try {
    connection = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: null,
    });

    // Create email queue
    emailQueue = new Queue('email', { connection });

    // Create email worker
    emailWorker = new Worker(
      'email',
      async (job: { data: any }) => {
        const { sendEmail } = await import('../email');
        await sendEmail(job.data);
      },
      { connection }
    );

    // Handle job events
    emailWorker.on('completed', (job: { id?: string }) => {
      console.log(`Email job ${job.id} completed`);
    });

    emailWorker.on('failed', (job: { id?: string } | undefined, err: Error) => {
      console.error(`Email job ${job?.id} failed:`, err);
    });

    console.log('Job queue initialized successfully');
    return { emailQueue, emailWorker };
  } catch (error) {
    console.error('Failed to initialize job queue:', error);
    return null;
  }
}

export function getEmailQueue(): Queue | null {
  return emailQueue;
}

export async function addEmailJob(data: any, options?: { priority?: number; delay?: number }) {
  if (!emailQueue) {
    // Fallback to in-memory queue if Redis not available
    const { queueEmail } = await import('../email/queue');
    await queueEmail({
      to: data.to,
      subject: data.subject,
      html: data.html || '',
      text: data.text,
      from: data.from,
      priority: 'normal',
    });
    return;
  }

  await emailQueue.add('send-email', data, {
    priority: options?.priority || 0,
    delay: options?.delay || 0,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
  });
}

export async function closeQueues() {
  if (emailWorker) {
    await emailWorker.close();
  }
  if (emailQueue) {
    await emailQueue.close();
  }
  if (connection) {
    await connection.quit();
  }
}






