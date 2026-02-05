// Email queue system for async email sending
// Uses in-memory queue for now (can be upgraded to Bull/BullMQ later)

interface QueuedEmail {
  id: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
  priority: 'high' | 'normal' | 'low';
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
  scheduledFor?: Date;
}

class EmailQueue {
  private queue: QueuedEmail[] = [];
  private processing = false;
  private maxConcurrent = 5;
  private currentProcessing = 0;

  /**
   * Add email to queue
   */
  async enqueue(email: Omit<QueuedEmail, 'id' | 'attempts' | 'createdAt'>): Promise<string> {
    const id = `email-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const queuedEmail: QueuedEmail = {
      id,
      ...email,
      attempts: 0,
      createdAt: new Date(),
    };

    this.queue.push(queuedEmail);
    this.processQueue();

    return id;
  }

  /**
   * Process queue
   */
  private async processQueue(): Promise<void> {
    if (this.processing || this.currentProcessing >= this.maxConcurrent) {
      return;
    }

    this.processing = true;

    while (this.queue.length > 0 && this.currentProcessing < this.maxConcurrent) {
      const email = this.queue.shift();
      if (!email) break;

      // Check if scheduled for future
      if (email.scheduledFor && email.scheduledFor > new Date()) {
        this.queue.push(email); // Put back in queue
        continue;
      }

      this.currentProcessing++;
      this.sendEmail(email).finally(() => {
        this.currentProcessing--;
        if (this.queue.length > 0) {
          this.processQueue();
        } else {
          this.processing = false;
        }
      });
    }

    this.processing = false;
  }

  /**
   * Send email
   */
  private async sendEmail(email: QueuedEmail): Promise<void> {
    try {
      const { sendEmail } = await import('./index');
      await sendEmail({
        to: email.to,
        subject: email.subject,
        html: email.html,
        text: email.text,
        from: email.from,
      });
    } catch (error: any) {
      console.error(`Error sending email ${email.id}:`, error);
      
      // Retry if attempts < maxAttempts
      if (email.attempts < email.maxAttempts) {
        email.attempts++;
        // Exponential backoff: wait 2^attempts seconds
        const delay = Math.pow(2, email.attempts) * 1000;
        email.scheduledFor = new Date(Date.now() + delay);
        this.queue.push(email);
      } else {
        console.error(`Email ${email.id} failed after ${email.maxAttempts} attempts`);
      }
    }
  }

  /**
   * Get queue status
   */
  getStatus(): { queued: number; processing: number } {
    return {
      queued: this.queue.length,
      processing: this.currentProcessing,
    };
  }
}

export const emailQueue = new EmailQueue();

/**
 * Send email via queue
 */
export async function queueEmail(
  email: Omit<QueuedEmail, 'id' | 'attempts' | 'createdAt' | 'maxAttempts' | 'priority'> & {
    priority?: 'high' | 'normal' | 'low';
    maxAttempts?: number;
    scheduledFor?: Date;
  }
): Promise<string> {
  return emailQueue.enqueue({
    ...email,
    priority: email.priority || 'normal',
    maxAttempts: email.maxAttempts || 3,
    scheduledFor: email.scheduledFor,
  });
}






