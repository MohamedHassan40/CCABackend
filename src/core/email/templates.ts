import { CCA_EMAIL as T } from './branding';
import { escapeHtml } from './htmlEscape';
import { ccaButton, ccaEmailShell, ccaMutedBox } from './layout';

import type { EmailBrandConfig } from '../auth/magicLink';

function p(text: string): string {
  return `<p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:${T.foreground};">${text}</p>`;
}

function brandedShell(
  opts: Parameters<typeof ccaEmailShell>[0],
  brand?: EmailBrandConfig | null
): string {
  return ccaEmailShell({
    ...opts,
    brandName: brand?.name ?? opts.brandName,
    brandTagline: brand?.tagline ?? opts.brandTagline,
    brandPrimaryColor: brand?.primaryColor ?? opts.brandPrimaryColor,
  });
}

export const emailTemplates = {
  /** After self-service registration — single consolidated welcome. */
  registrationComplete: (userName: string, orgName: string, loginUrl: string) => {
    const u = escapeHtml(userName);
    const o = escapeHtml(orgName);
    const inner = `
      ${p(`Hello ${u},`)}
      ${p(`Your account and organization <strong>${o}</strong> are ready on CCA.`)}
      ${p('You can sign in anytime to manage modules, billing, and your team.')}
      ${ccaButton(loginUrl, 'Sign in to CCA')}
      ${ccaMutedBox(`<strong style="color:${T.muted};font-size:12px;text-transform:uppercase;letter-spacing:0.04em;">Organization</strong><br /><span style="font-size:15px;color:${T.foreground};">${o}</span>`)}
    `;
    return {
      subject: `Welcome to CCA — ${orgName} is ready`,
      html: ccaEmailShell({
        previewText: `Your organization ${orgName} is set up. Sign in to get started.`,
        title: 'Welcome aboard',
        innerHtml: inner,
      }),
    };
  },

  /** Legacy alias used by auth — same content as registrationComplete. */
  welcomeEmail: (userName: string, orgName: string, loginUrl: string) =>
    emailTemplates.registrationComplete(userName, orgName, loginUrl),

  organizationCreated: (orgName: string, _adminEmail: string, loginUrl: string) => {
    const o = escapeHtml(orgName);
    const inner = `
      ${p(`Organization <strong>${o}</strong> is active on CCA.`)}
      ${p('Invite your team, enable modules, and explore the dashboard.')}
      ${ccaButton(loginUrl, 'Open dashboard')}
    `;
    return {
      subject: `Organization ready — ${orgName}`,
      html: ccaEmailShell({
        previewText: `${orgName} is ready on CCA.`,
        title: 'Your workspace is live',
        innerHtml: inner,
      }),
    };
  },

  trialStarted: (orgName: string, moduleName: string, trialEndsAt: Date) => {
    const inner = `
      ${p(`Hello,`)}
      ${p(`Your trial for <strong>${escapeHtml(moduleName)}</strong> has started for <strong>${escapeHtml(orgName)}</strong>.`)}
      ${p(`<strong>Trial ends:</strong> ${escapeHtml(trialEndsAt.toLocaleString())}`)}
    `;
    return {
      subject: `Trial started — ${moduleName}`,
      html: ccaEmailShell({
        previewText: `Trial for ${moduleName} is active.`,
        title: 'Trial activated',
        innerHtml: inner,
      }),
    };
  },

  trialExpiring: (orgName: string, moduleName: string, daysLeft: number, renewUrl: string) => {
    const isLastDay = daysLeft <= 0;
    const title = isLastDay ? 'Trial ends today' : `Trial ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
    const inner = `
      ${p(`Hello,`)}
      ${p(
        isLastDay
          ? `The trial for <strong>${escapeHtml(moduleName)}</strong> in <strong>${escapeHtml(orgName)}</strong> ends today.`
          : `The trial for <strong>${escapeHtml(moduleName)}</strong> in <strong>${escapeHtml(orgName)}</strong> is ending soon.`
      )}
      ${p('Subscribe to keep uninterrupted access to this module.')}
      ${ccaButton(renewUrl, 'Review billing & modules')}
    `;
    return {
      subject: isLastDay
        ? `Last day of trial — ${moduleName}`
        : `Trial ending soon — ${moduleName} (${daysLeft} days)`,
      html: ccaEmailShell({
        previewText: `${moduleName} trial ${isLastDay ? 'ends today' : `in ${daysLeft} days`}.`,
        title,
        innerHtml: inner,
      }),
    };
  },

  /** Paid / dated module access with expiresAt (non-trial). */
  moduleAccessExpiring: (
    orgName: string,
    moduleName: string,
    daysLeft: number,
    renewUrl: string
  ) => {
    const title =
      daysLeft <= 0
        ? 'Module access ends today'
        : `Module renews in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
    const accessLine =
      daysLeft <= 0
        ? `Access to <strong>${escapeHtml(moduleName)}</strong> for <strong>${escapeHtml(orgName)}</strong> <strong>expires today</strong>.`
        : `Access to <strong>${escapeHtml(moduleName)}</strong> for <strong>${escapeHtml(orgName)}</strong> expires in <strong>${daysLeft}</strong> day${daysLeft === 1 ? '' : 's'}.`;
    const inner = `
      ${p(`Hello,`)}
      ${p(accessLine)}
      ${p('Renew from billing to avoid interruption.')}
      ${ccaButton(renewUrl, 'Manage subscription')}
    `;
    return {
      subject:
        daysLeft <= 0
          ? `Action needed — ${moduleName} expires today`
          : `Reminder — ${moduleName} expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
      html: ccaEmailShell({
        previewText: `${moduleName} access ending soon for ${orgName}.`,
        title,
        innerHtml: inner,
      }),
    };
  },

  organizationPendingApproval: (orgName: string, _adminEmail: string) => ({
    subject: `Registration received — ${orgName}`,
    html: ccaEmailShell({
      previewText: `We received your registration for ${orgName}.`,
      title: 'Pending approval',
      innerHtml: `
        ${p(`Thank you for registering <strong>${escapeHtml(orgName)}</strong>.`)}
        ${p('Your application is being reviewed. We will email you when it is approved.')}
      `,
    }),
  }),

  organizationApproved: (orgName: string, _adminEmail: string, loginUrl: string) => ({
    subject: `${orgName} has been approved`,
    html: ccaEmailShell({
      previewText: `Your organization ${orgName} is approved on CCA.`,
      title: 'You are approved',
      innerHtml: `
        ${p(`Congratulations — <strong>${escapeHtml(orgName)}</strong> is approved.`)}
        ${ccaButton(loginUrl, 'Sign in to CCA')}
      `,
    }),
  }),

  organizationRejected: (orgName: string, _adminEmail: string, reason?: string) => ({
    subject: `Update on ${orgName}`,
    html: ccaEmailShell({
      previewText: `Registration update for ${orgName}.`,
      title: 'Registration update',
      innerHtml: `
        ${p(`We could not approve <strong>${escapeHtml(orgName)}</strong> at this time.`)}
        ${reason ? p(`<strong>Detail:</strong> ${escapeHtml(reason)}`) : ''}
        ${p('Contact support if you would like to provide more information.')}
      `,
    }),
  }),

  passwordReset: (userName: string, resetUrl: string) => ({
    subject: 'Reset your CCA password',
    html: ccaEmailShell({
      previewText: 'Use the link below to reset your password.',
      title: 'Password reset',
      innerHtml: `
        ${p(`Hello ${escapeHtml(userName)},`)}
        ${p('We received a request to reset your password. This link expires in one hour.')}
        ${ccaButton(resetUrl, 'Reset password')}
        ${ccaMutedBox(`If the button does not work, copy this URL:<br /><span style="word-break:break-all;font-size:13px;color:${T.muted};">${escapeHtml(resetUrl)}</span>`)}
        ${p(`If you did not request this, you can ignore this email.`)}
      `,
    }),
  }),

  emailOtp: (userName: string, code: string, validMinutes: number) => ({
    subject: `Your CCA verification code — ${code}`,
    html: ccaEmailShell({
      previewText: `Your code is ${code}. It expires in ${validMinutes} minutes.`,
      title: 'Verification code',
      innerHtml: `
        ${p(`Hello ${escapeHtml(userName)},`)}
        ${p('Use this one-time code to continue:')}
        ${ccaMutedBox(
          `<span style="font-size:28px;font-weight:700;letter-spacing:0.25em;color:${T.primaryDark};">${escapeHtml(code)}</span>`
        )}
        ${p(`This code expires in <strong>${validMinutes}</strong> minutes. Do not share it with anyone.`)}
      `,
    }),
  }),

  purchaseConfirmation: (params: {
    userName: string;
    orgName: string;
    moduleName: string;
    amountLabel: string;
    billingUrl: string;
  }) => {
    const { userName, orgName, moduleName, amountLabel, billingUrl } = params;
    return {
      subject: `Payment received — ${moduleName}`,
      html: ccaEmailShell({
        previewText: `Thank you for your payment of ${amountLabel}.`,
        title: 'Payment confirmed',
        innerHtml: `
          ${p(`Hello ${escapeHtml(userName)},`)}
          ${p(`We received your payment for <strong>${escapeHtml(moduleName)}</strong> (${escapeHtml(orgName)}).`)}
          ${ccaMutedBox(
            `<strong>Amount</strong><br /><span style="font-size:18px;font-weight:700;color:${T.foreground};">${escapeHtml(amountLabel)}</span>`
          )}
          ${p('Your subscription is updated. You can review invoices and plans anytime.')}
          ${ccaButton(billingUrl, 'View billing')}
        `,
      }),
    };
  },

  paymentFailed: (orgName: string, moduleName: string, amount: string, retryUrl: string) => ({
    subject: `Payment failed — ${moduleName}`,
    html: ccaEmailShell({
      previewText: `We could not process payment for ${moduleName}.`,
      title: 'Payment issue',
      innerHtml: `
        ${p(`We could not process payment for <strong>${escapeHtml(moduleName)}</strong> (${escapeHtml(orgName)}).`)}
        ${p(`<strong>Amount:</strong> ${escapeHtml(amount)}`)}
        ${ccaButton(retryUrl, 'Update payment method')}
      `,
    }),
  }),

  subscriptionRenewalReminder: (
    orgName: string,
    moduleName: string,
    renewalDate: Date,
    amount: string
  ) => ({
    subject: `Renewal reminder — ${moduleName}`,
    html: ccaEmailShell({
      previewText: `Subscription renews on ${renewalDate.toLocaleDateString()}.`,
      title: 'Upcoming renewal',
      innerHtml: `
        ${p(`<strong>${escapeHtml(moduleName)}</strong> for <strong>${escapeHtml(orgName)}</strong> renews on <strong>${escapeHtml(
          renewalDate.toLocaleDateString()
        )}</strong>.`)}
        ${p(`<strong>Amount:</strong> ${escapeHtml(amount)}`)}
        ${p('Your saved payment method may be charged automatically.')}
      `,
    }),
  }),

  subscriptionCancelled: (orgName: string, moduleName: string, endDate: Date) => ({
    subject: `Subscription cancelled — ${moduleName}`,
    html: ccaEmailShell({
      previewText: `Access for ${moduleName} ends ${endDate.toLocaleDateString()}.`,
      title: 'Subscription cancelled',
      innerHtml: `
        ${p(`<strong>${escapeHtml(moduleName)}</strong> for <strong>${escapeHtml(orgName)}</strong> has been cancelled.`)}
        ${p(`Access continues until <strong>${escapeHtml(endDate.toLocaleDateString())}</strong>.`)}
      `,
    }),
  }),

  invoiceGenerated: (
    orgName: string,
    invoiceNumber: string,
    amount: string,
    invoiceUrl: string,
    dueDate: Date
  ) => ({
    subject: `Invoice ${invoiceNumber}`,
    html: ccaEmailShell({
      previewText: `Invoice ${invoiceNumber} for ${amount}.`,
      title: `Invoice ${escapeHtml(invoiceNumber)}`,
      innerHtml: `
        ${p(`Invoice for <strong>${escapeHtml(orgName)}</strong>.`)}
        ${p(`<strong>Amount:</strong> ${escapeHtml(amount)}<br /><strong>Due:</strong> ${escapeHtml(dueDate.toLocaleDateString())}`)}
        ${ccaButton(invoiceUrl, 'View invoice')}
      `,
    }),
  }),

  trialExpired: (orgName: string, moduleName: string, subscribeUrl: string) => ({
    subject: `Trial ended — ${moduleName}`,
    html: ccaEmailShell({
      previewText: `Trial for ${moduleName} has ended.`,
      title: 'Trial ended',
      innerHtml: `
        ${p(`The trial for <strong>${escapeHtml(moduleName)}</strong> in <strong>${escapeHtml(orgName)}</strong> has ended.`)}
        ${ccaButton(subscribeUrl, 'Subscribe to continue')}
      `,
    }),
  }),

  /** After dated module access (expiresAt) lapses. */
  subscriptionAccessEnded: (orgName: string, moduleName: string, renewUrl: string) => ({
    subject: `Module access ended — ${moduleName}`,
    html: ccaEmailShell({
      previewText: `${moduleName} access has ended for ${orgName}.`,
      title: 'Module access ended',
      innerHtml: `
        ${p(`Scheduled access to <strong>${escapeHtml(moduleName)}</strong> for <strong>${escapeHtml(orgName)}</strong> has ended.`)}
        ${ccaButton(renewUrl, 'Renew or manage modules')}
      `,
    }),
  }),

  ticketSubmitted: (
    orgName: string,
    ticketId: string,
    title: string,
    trackUrl: string
  ) => ({
    subject: `Support ticket received — ${orgName}`,
    html: ccaEmailShell({
      previewText: `We received your request: ${title}`,
      title: 'Ticket received',
      innerHtml: `
        ${p(`Thank you for contacting <strong>${escapeHtml(orgName)}</strong>.`)}
        ${p(`<strong>Ticket ID:</strong> ${escapeHtml(ticketId)}`)}
        ${p(`<strong>Subject:</strong> ${escapeHtml(title)}`)}
        ${p('Use your email and ticket ID to track replies.')}
        ${ccaButton(trackUrl, 'Track your ticket')}
      `,
    }),
  }),

  ticketReplyToCustomer: (
    orgName: string,
    ticketId: string,
    title: string,
    trackUrl: string
  ) => ({
    subject: `New reply on your ticket — ${orgName}`,
    html: ccaEmailShell({
      previewText: `There is a new reply on: ${title}`,
      title: 'New reply',
      innerHtml: `
        ${p(`Your ticket <strong>${escapeHtml(ticketId)}</strong> has a new reply.`)}
        ${p(`<strong>Subject:</strong> ${escapeHtml(title)}`)}
        ${ccaButton(trackUrl, 'View conversation')}
      `,
    }),
  }),

  ticketAssignedToAgent: (ticketId: string, title: string, dashboardUrl: string) => ({
    subject: `Ticket assigned: ${title}`,
    html: ccaEmailShell({
      previewText: `You were assigned ticket ${ticketId}`,
      title: 'New assignment',
      innerHtml: `
        ${p(`You have been assigned ticket <strong>${escapeHtml(ticketId)}</strong>.`)}
        ${p(`<strong>Subject:</strong> ${escapeHtml(title)}`)}
        ${ccaButton(dashboardUrl, 'Open ticket')}
      `,
    }),
  }),

  membershipRegistered: (
    memberName: string,
    orgName: string,
    membershipTypeName: string,
    membershipNumber: string,
    trackUrl: string,
    portalUrl: string,
    requiresPayment: boolean
  ) => {
    const inner = `
      ${p(`Hello ${escapeHtml(memberName)},`)}
      ${p(`Your membership with <strong>${escapeHtml(orgName)}</strong> has been registered.`)}
      ${p(`<strong>Plan:</strong> ${escapeHtml(membershipTypeName)}`)}
      ${p(`<strong>Reference:</strong> ${escapeHtml(membershipNumber)}`)}
      ${requiresPayment
        ? p('Payment is still required to activate your membership. Use the link below to complete checkout.')
        : p('Your membership is active. Sign in to view your digital card and announcements.')}
      ${ccaButton(requiresPayment ? trackUrl : portalUrl, requiresPayment ? 'Complete payment' : 'Open member portal')}
      ${ccaMutedBox(`Track status anytime: <a href="${escapeHtml(trackUrl)}" style="color:${T.primary};">${escapeHtml(trackUrl)}</a>`)}
    `;
    return {
      subject: requiresPayment
        ? `Complete your membership — ${orgName}`
        : `Welcome — ${orgName} membership`,
      html: ccaEmailShell({
        previewText: `Membership reference ${membershipNumber}`,
        title: requiresPayment ? 'Almost there' : 'Welcome',
        innerHtml: inner,
      }),
    };
  },

  membershipPaymentConfirmed: (
    memberName: string,
    orgName: string,
    membershipTypeName: string,
    validUntil: string,
    portalUrl: string
  ) => ({
    subject: `Payment received — ${orgName}`,
    html: ccaEmailShell({
      previewText: 'Your membership is now active',
      title: 'Payment confirmed',
      innerHtml: `
        ${p(`Hello ${escapeHtml(memberName)},`)}
        ${p(`Thank you! Your payment for <strong>${escapeHtml(membershipTypeName)}</strong> at ${escapeHtml(orgName)} was successful.`)}
        ${p(`Your membership is active until <strong>${escapeHtml(validUntil)}</strong>.`)}
        ${ccaButton(portalUrl, 'View my membership card')}
      `,
    }),
  }),

  membershipExpiringSoon: (
    memberName: string,
    orgName: string,
    daysRemaining: number,
    endDate: string,
    renewUrl: string
  ) => ({
    subject: `Your ${orgName} membership expires in ${daysRemaining} days`,
    html: ccaEmailShell({
      previewText: `Renew before ${endDate}`,
      title: 'Renewal reminder',
      innerHtml: `
        ${p(`Hello ${escapeHtml(memberName)},`)}
        ${p(`Your membership with <strong>${escapeHtml(orgName)}</strong> expires on <strong>${escapeHtml(endDate)}</strong> (${daysRemaining} day(s) left).`)}
        ${ccaButton(renewUrl, 'Renew membership')}
      `,
    }),
  }),

  membershipExpired: (memberName: string, orgName: string, renewUrl: string) => ({
    subject: `Your ${orgName} membership has expired`,
    html: ccaEmailShell({
      previewText: 'Renew to restore access',
      title: 'Membership expired',
      innerHtml: `
        ${p(`Hello ${escapeHtml(memberName)},`)}
        ${p(`Your membership with <strong>${escapeHtml(orgName)}</strong> has expired.`)}
        ${ccaButton(renewUrl, 'Renew now')}
      `,
    }),
  }),

  membershipAnnouncement: (orgName: string, title: string, content: string, optionalUrl?: string) => {
    const ti = escapeHtml(title);
    const bodyHtml = escapeHtml(content).replace(/\r\n/g, '\n').replace(/\n/g, '<br />');
    const inner = `
      ${p(`<strong>${escapeHtml(orgName)}</strong>`)}
      ${p(`<strong style="font-size:17px;">${ti}</strong>`)}
      ${p(bodyHtml)}
      ${optionalUrl ? ccaButton(optionalUrl, 'Open organization') : ''}
    `;
    return {
      subject: `${title} — ${orgName}`,
      html: ccaEmailShell({
        previewText: title.slice(0, 140),
        title: 'Announcement',
        innerHtml: inner,
      }),
    };
  },

  magicLinkLogin: (userName: string, loginUrl: string, expiresMinutes: number, brand?: EmailBrandConfig | null) => ({
    subject: 'Your sign-in link',
    html: brandedShell(
      {
        previewText: 'Use this link to sign in securely',
        title: 'Sign in',
        innerHtml: `
          ${p(`Hello ${escapeHtml(userName)},`)}
          ${p(`Use the button below to sign in. This link expires in ${expiresMinutes} minutes.`)}
          ${ccaButton(loginUrl, 'Sign in')}
          ${ccaMutedBox('If you did not request this link, you can ignore this email.')}
        `,
      },
      brand
    ),
  }),

  memberPortalInvite: (memberName: string, orgName: string, loginUrl: string, brand?: EmailBrandConfig | null) => ({
    subject: `Your ${orgName} member portal`,
    html: brandedShell(
      {
        previewText: 'Access your membership card and renew online',
        title: 'Member portal ready',
        innerHtml: `
          ${p(`Hello ${escapeHtml(memberName)},`)}
          ${p(`Your member account for <strong>${escapeHtml(orgName)}</strong> is ready.`)}
          ${ccaButton(loginUrl, 'Open member portal')}
        `,
      },
      brand
    ),
  }),

  ticketAgentReplyToCustomer: (
    orgName: string,
    ticketId: string,
    title: string,
    replyPreview: string,
    trackUrl: string,
    brand?: EmailBrandConfig | null
  ) => ({
    subject: `Reply on your ticket — ${orgName}`,
    html: brandedShell(
      {
        previewText: replyPreview.slice(0, 120),
        title: 'New reply from support',
        innerHtml: `
          ${p(`Your ticket <strong>${escapeHtml(ticketId)}</strong> has a new reply.`)}
          ${p(`<strong>Subject:</strong> ${escapeHtml(title)}`)}
          ${ccaMutedBox(escapeHtml(replyPreview).replace(/\n/g, '<br />'))}
          ${ccaButton(trackUrl, 'View full conversation')}
        `,
      },
      brand
    ),
  }),

  slaBreachToAssignee: (
    ticketTitle: string,
    breachType: string,
    dashboardUrl: string,
    brand?: EmailBrandConfig | null
  ) => ({
    subject: `SLA ${breachType}: ${ticketTitle}`,
    html: brandedShell(
      {
        previewText: `SLA ${breachType} on ${ticketTitle}`,
        title: 'SLA alert',
        innerHtml: `
          ${p(`Ticket <strong>${escapeHtml(ticketTitle)}</strong> — ${escapeHtml(breachType)}.`)}
          ${ccaButton(dashboardUrl, 'Open ticket')}
        `,
      },
      brand
    ),
  }),

  pmoBudgetAlert: (
    orgName: string,
    projectName: string,
    usedPct: number,
    projectUrl: string,
    brand?: EmailBrandConfig | null
  ) => ({
    subject: `Budget alert: ${projectName}`,
    html: brandedShell(
      {
        previewText: `${projectName} is at ${usedPct}% of budget`,
        title: 'Budget alert',
        innerHtml: `
          ${p(`Project <strong>${escapeHtml(projectName)}</strong> at ${escapeHtml(orgName)} has reached <strong>${usedPct}%</strong> of budget.`)}
          ${ccaButton(projectUrl, 'Review project')}
        `,
      },
      brand
    ),
  }),

  pmoGateReady: (
    projectName: string,
    phaseLabel: string,
    projectUrl: string,
    brand?: EmailBrandConfig | null
  ) => ({
    subject: `Phase gate ready: ${projectName}`,
    html: brandedShell(
      {
        previewText: `${phaseLabel} phase ready for sign-off`,
        title: 'Phase gate ready for approval',
        innerHtml: `
          ${p(`Project <strong>${escapeHtml(projectName)}</strong>: <strong>${escapeHtml(phaseLabel)}</strong> phase requirements are complete. Sponsor and PMO sign-off required.`)}
          ${ccaButton(projectUrl, 'Review gate')}
        `,
      },
      brand
    ),
  }),

  pmoGateSignoff: (
    projectName: string,
    phaseLabel: string,
    role: string,
    signerName: string,
    fullyApproved: boolean,
    projectUrl: string,
    brand?: EmailBrandConfig | null
  ) => ({
    subject: fullyApproved ? `Phase approved: ${projectName}` : `Gate sign-off: ${projectName}`,
    html: brandedShell(
      {
        previewText: fullyApproved ? `${phaseLabel} phase fully approved` : `${signerName} signed as ${role}`,
        title: fullyApproved ? 'Phase gate approved' : 'Phase gate sign-off',
        innerHtml: fullyApproved
          ? `${p(`Project <strong>${escapeHtml(projectName)}</strong>: <strong>${escapeHtml(phaseLabel)}</strong> phase is fully approved and the project has advanced.`)}${ccaButton(projectUrl, 'View project')}`
          : `${p(`<strong>${escapeHtml(signerName)}</strong> signed off as <strong>${escapeHtml(role)}</strong> for ${escapeHtml(phaseLabel)} phase on <strong>${escapeHtml(projectName)}</strong>.`)}${ccaButton(projectUrl, 'View gate')}`,
      },
      brand
    ),
  }),

  pmoChangeRequest: (
    projectName: string,
    title: string,
    event: string,
    actorName: string,
    projectUrl: string,
    brand?: EmailBrandConfig | null
  ) => ({
    subject: `Change request: ${title}`,
    html: brandedShell(
      {
        previewText: `${event} — ${title}`,
        title: 'Change request update',
        innerHtml: `
          ${p(`Project <strong>${escapeHtml(projectName)}</strong>: change request <strong>${escapeHtml(title)}</strong> — ${escapeHtml(event)} by ${escapeHtml(actorName)}.`)}
          ${ccaButton(projectUrl, 'Review change request')}
        `,
      },
      brand
    ),
  }),
};
