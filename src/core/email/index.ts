import sgMail from '@sendgrid/mail';
import type { MailDataRequired } from '@sendgrid/helpers/classes/mail';
import { getSendGridFrom } from './from';
import { emailTemplates } from './templates';

export type EmailFrom = string | { email: string; name: string };

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: EmailFrom;
}

if (!process.env.SENDGRID_API_KEY) {
  console.warn('SENDGRID_API_KEY not set. Email via SendGrid is disabled unless SMTP is configured.');
}

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

export async function sendEmail(options: EmailOptions): Promise<void> {
  const smtpHost = process.env.SMTP_HOST?.trim();
  const smtpUser = process.env.SMTP_USER?.trim();
  const smtpPass = process.env.SMTP_PASS?.trim();

  if (smtpHost && smtpUser && smtpPass) {
    try {
      const nodemailer = await import('nodemailer');
      const port = parseInt(process.env.SMTP_PORT || '587', 10);
      const secure = process.env.SMTP_SECURE === 'true';
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port,
        secure,
        auth: { user: smtpUser, pass: smtpPass },
      });
      const fromAddr = process.env.SMTP_FROM?.trim() || smtpUser;
      await transporter.sendMail({
        from: fromAddr,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text || options.html.replace(/<[^>]*>/g, ''),
      });
      return;
    } catch (error) {
      console.error('Error sending email via SMTP:', error);
      throw error;
    }
  }

  if (!process.env.SENDGRID_API_KEY) {
    console.log('Email skipped (set SMTP_* for Gmail/SMTP or SENDGRID_API_KEY):', options.to, options.subject);
    return;
  }

  try {
    const msg: MailDataRequired = {
      to: options.to,
      from: options.from ?? getSendGridFrom(),
      subject: options.subject,
      html: options.html,
      text: options.text || options.html.replace(/<[^>]*>/g, ''),
    };
    await sgMail.send(msg);
  } catch (error) {
    console.error('Error sending email:', error);
    throw error;
  }
}

/**
 * Send email via queue (async, non-blocking)
 */
export async function sendEmailQueued(
  options: EmailOptions & { priority?: 'high' | 'normal' | 'low' }
): Promise<string> {
  const { queueEmail } = await import('./queue');
  return queueEmail({
    to: options.to,
    subject: options.subject,
    html: options.html,
    text: options.text,
    from: options.from,
    priority: options.priority || 'normal',
  });
}

export { emailTemplates };
