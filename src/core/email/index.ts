import sgMail from '@sendgrid/mail';

if (!process.env.SENDGRID_API_KEY) {
  console.warn('SENDGRID_API_KEY not set. Email functionality will be disabled.');
}

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
}

export async function sendEmail(options: EmailOptions): Promise<void> {
  if (!process.env.SENDGRID_API_KEY) {
    console.log('Email would be sent (SENDGRID_API_KEY not configured):', options);
    return;
  }

  try {
    await sgMail.send({
      to: options.to,
      from: options.from || process.env.SENDGRID_FROM_EMAIL || 'noreply@cloudorg.com',
      subject: options.subject,
      html: options.html,
      text: options.text || options.html.replace(/<[^>]*>/g, ''),
    });
  } catch (error) {
    console.error('Error sending email:', error);
    throw error;
  }
}

/**
 * Send email via queue (async, non-blocking)
 */
export async function sendEmailQueued(options: EmailOptions & { priority?: 'high' | 'normal' | 'low' }): Promise<string> {
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

export const emailTemplates = {
  organizationCreated: (orgName: string, adminEmail: string, loginUrl: string) => ({
    subject: `Welcome to Cloud Org - Your organization "${orgName}" is ready!`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #000063;">Welcome to Cloud Org!</h1>
        <p>Your organization <strong>${orgName}</strong> has been created successfully.</p>
        <p>You can now log in and start using the platform:</p>
        <a href="${loginUrl}" style="display: inline-block; padding: 12px 24px; background-color: #000063; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0;">
          Log In
        </a>
        <p style="color: #666; font-size: 14px; margin-top: 30px;">
          If you have any questions, please contact our support team.
        </p>
      </div>
    `,
  }),

  trialStarted: (orgName: string, moduleName: string, trialEndsAt: Date) => ({
    subject: `Trial Started: ${moduleName} for ${orgName}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #000063;">Trial Started</h1>
        <p>Your trial for <strong>${moduleName}</strong> has started for organization <strong>${orgName}</strong>.</p>
        <p>Trial ends on: <strong>${trialEndsAt.toLocaleDateString()}</strong></p>
        <p>Enjoy exploring the features!</p>
      </div>
    `,
  }),

  trialExpiring: (orgName: string, moduleName: string, daysLeft: number) => ({
    subject: `Trial Expiring Soon: ${moduleName}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #f0b241;">Trial Expiring Soon</h1>
        <p>Your trial for <strong>${moduleName}</strong> in organization <strong>${orgName}</strong> expires in ${daysLeft} day${daysLeft > 1 ? 's' : ''}.</p>
        <p>Subscribe now to continue using the module without interruption.</p>
      </div>
    `,
  }),

  organizationPendingApproval: (orgName: string, adminEmail: string) => ({
    subject: `Organization Registration Pending Approval: ${orgName}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #000063;">Registration Received</h1>
        <p>Thank you for registering your organization <strong>${orgName}</strong> on Cloud Org.</p>
        <p>Your registration is currently <strong>pending approval</strong> by our team. We will review your application and notify you once it's been approved.</p>
        <p style="color: #666; font-size: 14px; margin-top: 30px;">
          You will receive an email notification once your organization has been approved.
        </p>
      </div>
    `,
  }),

  organizationApproved: (orgName: string, adminEmail: string, loginUrl: string) => ({
    subject: `Your Organization "${orgName}" Has Been Approved!`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #000063;">Congratulations!</h1>
        <p>Your organization <strong>${orgName}</strong> has been <strong style="color: #28a745;">approved</strong>!</p>
        <p>You can now log in and start using the platform:</p>
        <a href="${loginUrl}" style="display: inline-block; padding: 12px 24px; background-color: #000063; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0;">
          Log In Now
        </a>
        <p style="color: #666; font-size: 14px; margin-top: 30px;">
          If you have any questions, please contact our support team.
        </p>
      </div>
    `,
  }),

  organizationRejected: (orgName: string, adminEmail: string, reason?: string) => ({
    subject: `Organization Registration Update: ${orgName}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #dc3545;">Registration Update</h1>
        <p>We regret to inform you that your organization registration for <strong>${orgName}</strong> could not be approved at this time.</p>
        ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}
        <p>If you believe this is an error or would like to provide additional information, please contact our support team.</p>
        <p style="color: #666; font-size: 14px; margin-top: 30px;">
          Thank you for your interest in Cloud Org.
        </p>
      </div>
    `,
  }),

  welcomeEmail: (userName: string, orgName: string, loginUrl: string) => ({
    subject: `Welcome to Cloud Org, ${userName}!`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #000063;">Welcome to Cloud Org!</h1>
        <p>Hello ${userName},</p>
        <p>Welcome to <strong>${orgName}</strong> on Cloud Org! We're excited to have you on board.</p>
        <p>You can now log in and start using the platform:</p>
        <a href="${loginUrl}" style="display: inline-block; padding: 12px 24px; background-color: #000063; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0;">
          Log In Now
        </a>
        <p>If you have any questions, our support team is here to help.</p>
        <p style="color: #666; font-size: 14px; margin-top: 30px;">
          Best regards,<br>Cloud Org Team
        </p>
      </div>
    `,
  }),

  paymentFailed: (orgName: string, moduleName: string, amount: string, retryUrl: string) => ({
    subject: `Payment Failed: ${moduleName} Subscription`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #dc3545;">Payment Failed</h1>
        <p>Hello,</p>
        <p>We were unable to process your payment for the <strong>${moduleName}</strong> subscription in organization <strong>${orgName}</strong>.</p>
        <p><strong>Amount:</strong> ${amount}</p>
        <p>Please update your payment method to continue using the module:</p>
        <a href="${retryUrl}" style="display: inline-block; padding: 12px 24px; background-color: #000063; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0;">
          Update Payment Method
        </a>
        <p style="color: #666; font-size: 14px; margin-top: 30px;">
          If you have any questions, please contact our support team.
        </p>
      </div>
    `,
  }),

  subscriptionRenewalReminder: (orgName: string, moduleName: string, renewalDate: Date, amount: string) => ({
    subject: `Subscription Renewal Reminder: ${moduleName}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #f0b241;">Subscription Renewal Reminder</h1>
        <p>Hello,</p>
        <p>Your subscription for <strong>${moduleName}</strong> in organization <strong>${orgName}</strong> will renew on <strong>${renewalDate.toLocaleDateString()}</strong>.</p>
        <p><strong>Renewal Amount:</strong> ${amount}</p>
        <p>Your payment method on file will be charged automatically. If you need to update your payment method, please do so before the renewal date.</p>
        <p style="color: #666; font-size: 14px; margin-top: 30px;">
          Thank you for using Cloud Org!
        </p>
      </div>
    `,
  }),

  subscriptionCancelled: (orgName: string, moduleName: string, endDate: Date) => ({
    subject: `Subscription Cancelled: ${moduleName}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #000063;">Subscription Cancelled</h1>
        <p>Hello,</p>
        <p>Your subscription for <strong>${moduleName}</strong> in organization <strong>${orgName}</strong> has been cancelled.</p>
        <p>You will continue to have access until <strong>${endDate.toLocaleDateString()}</strong>.</p>
        <p>If you change your mind, you can reactivate your subscription at any time.</p>
        <p style="color: #666; font-size: 14px; margin-top: 30px;">
          We're sorry to see you go. If you have feedback, we'd love to hear from you.
        </p>
      </div>
    `,
  }),

  invoiceGenerated: (orgName: string, invoiceNumber: string, amount: string, invoiceUrl: string, dueDate: Date) => ({
    subject: `Invoice ${invoiceNumber} from Cloud Org`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #000063;">Invoice ${invoiceNumber}</h1>
        <p>Hello,</p>
        <p>Your invoice for <strong>${orgName}</strong> is ready.</p>
        <p><strong>Amount:</strong> ${amount}</p>
        <p><strong>Due Date:</strong> ${dueDate.toLocaleDateString()}</p>
        <a href="${invoiceUrl}" style="display: inline-block; padding: 12px 24px; background-color: #000063; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0;">
          View Invoice
        </a>
        <p style="color: #666; font-size: 14px; margin-top: 30px;">
          Thank you for your business!
        </p>
      </div>
    `,
  }),

  trialExpired: (orgName: string, moduleName: string, subscribeUrl: string) => ({
    subject: `Trial Expired: ${moduleName}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #dc3545;">Trial Expired</h1>
        <p>Hello,</p>
        <p>Your trial for <strong>${moduleName}</strong> in organization <strong>${orgName}</strong> has expired.</p>
        <p>Subscribe now to continue using this module:</p>
        <a href="${subscribeUrl}" style="display: inline-block; padding: 12px 24px; background-color: #000063; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0;">
          Subscribe Now
        </a>
        <p style="color: #666; font-size: 14px; margin-top: 30px;">
          If you have any questions, please contact our support team.
        </p>
      </div>
    `,
  }),
};

