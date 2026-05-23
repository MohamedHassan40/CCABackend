import type { EmailBrandConfig } from '../auth/magicLink';
import {
  type EmailLocale,
  bilingualParagraph,
  buildLocalizedEmail,
  ccaButton,
  escapeHtml,
  p,
} from './i18n';

const defaultLocale: EmailLocale = 'en';

export function leaveSubmittedToApproversEmail(params: {
  employeeName: string;
  days: number;
  leaveTypeName: string;
  reviewUrl: string;
  locale?: EmailLocale;
  brand?: EmailBrandConfig | null;
}) {
  const e = escapeHtml(params.employeeName);
  const lt = escapeHtml(params.leaveTypeName);
  const d = String(params.days);
  return buildLocalizedEmail({
    locale: params.locale ?? defaultLocale,
    subjectEn: `Leave request — ${params.employeeName}`,
    subjectAr: `طلب إجازة — ${params.employeeName}`,
    titleEn: 'New leave request',
    titleAr: 'طلب إجازة جديد',
    previewEn: `${params.employeeName} requested ${d} day(s)`,
    previewAr: `${params.employeeName} طلب ${d} يوم/أيام`,
    bodyEn: `
      ${p(`${e} submitted a leave request for <strong>${d}</strong> day(s) of <strong>${lt}</strong>.`)}
      ${ccaButton(params.reviewUrl, 'Review request')}
    `,
    bodyAr: `
      ${p(`${e} قدّم طلب إجازة لمدة <strong>${d}</strong> يوم/أيام من نوع <strong>${lt}</strong>.`, true)}
      ${ccaButton(params.reviewUrl, 'مراجعة الطلب')}
    `,
    brand: params.brand,
  });
}

export function leaveApprovedEmail(params: {
  employeeName: string;
  days: number;
  leaveTypeName: string;
  locale?: EmailLocale;
  brand?: EmailBrandConfig | null;
}) {
  const lt = escapeHtml(params.leaveTypeName);
  const d = String(params.days);
  return buildLocalizedEmail({
    locale: params.locale ?? defaultLocale,
    subjectEn: 'Leave request approved',
    subjectAr: 'تمت الموافقة على طلب الإجازة',
    titleEn: 'Approved',
    titleAr: 'تمت الموافقة',
    previewEn: 'Your leave request was approved',
    previewAr: 'تمت الموافقة على طلب إجازتك',
    bodyEn: p(`Your request for <strong>${d}</strong> day(s) of <strong>${lt}</strong> was approved.`),
    bodyAr: p(`تمت الموافقة على طلبك لـ <strong>${d}</strong> يوم/أيام من <strong>${lt}</strong>.`, true),
    brand: params.brand,
  });
}

export function leaveRejectedEmail(params: {
  employeeName: string;
  days: number;
  leaveTypeName: string;
  reason?: string | null;
  locale?: EmailLocale;
  brand?: EmailBrandConfig | null;
}) {
  const lt = escapeHtml(params.leaveTypeName);
  const d = String(params.days);
  const reasonLineEn = params.reason
    ? p(`<strong>Reason:</strong> ${escapeHtml(params.reason)}`)
    : '';
  const reasonLineAr = params.reason
    ? p(`<strong>السبب:</strong> ${escapeHtml(params.reason)}`, true)
    : '';
  return buildLocalizedEmail({
    locale: params.locale ?? defaultLocale,
    subjectEn: 'Leave request rejected',
    subjectAr: 'تم رفض طلب الإجازة',
    titleEn: 'Not approved',
    titleAr: 'لم تتم الموافقة',
    previewEn: 'Your leave request was rejected',
    previewAr: 'تم رفض طلب إجازتك',
    bodyEn: `${p(`Your request for <strong>${d}</strong> day(s) of <strong>${lt}</strong> was rejected.`)}${reasonLineEn}`,
    bodyAr: `${p(`تم رفض طلبك لـ <strong>${d}</strong> يوم/أيام من <strong>${lt}</strong>.`, true)}${reasonLineAr}`,
    brand: params.brand,
  });
}

export function payrollApprovedEmail(params: {
  employeeName: string;
  periodLabel: string;
  locale?: EmailLocale;
  brand?: EmailBrandConfig | null;
}) {
  const period = escapeHtml(params.periodLabel);
  return buildLocalizedEmail({
    locale: params.locale ?? defaultLocale,
    subjectEn: 'Payroll approved',
    subjectAr: 'تمت الموافقة على كشف الراتب',
    titleEn: 'Payroll approved',
    titleAr: 'موافقة على الراتب',
    previewEn: 'Your payroll record was approved',
    previewAr: 'تمت الموافقة على سجل راتبك',
    bodyEn: p(`Your payroll for <strong>${period}</strong> has been approved.`),
    bodyAr: p(`تمت الموافقة على راتبك للفترة <strong>${period}</strong>.`, true),
    brand: params.brand,
  });
}

export function payrollPaidEmail(params: {
  employeeName: string;
  periodLabel: string;
  locale?: EmailLocale;
  brand?: EmailBrandConfig | null;
}) {
  const period = escapeHtml(params.periodLabel);
  return buildLocalizedEmail({
    locale: params.locale ?? defaultLocale,
    subjectEn: 'Payroll paid',
    subjectAr: 'تم صرف الراتب',
    titleEn: 'Payment processed',
    titleAr: 'تم الصرف',
    previewEn: 'Your payroll has been marked as paid',
    previewAr: 'تم تسجيل راتبك كمصروف',
    bodyEn: p(`Your payroll for <strong>${period}</strong> has been marked as paid.`),
    bodyAr: p(`تم تسجيل راتبك للفترة <strong>${period}</strong> كمصروف.`, true),
    brand: params.brand,
  });
}

export function ticketAssignedEmail(params: {
  ticketId: string;
  title: string;
  dashboardUrl: string;
  locale?: EmailLocale;
  brand?: EmailBrandConfig | null;
}) {
  const id = escapeHtml(params.ticketId);
  const t = escapeHtml(params.title);
  return buildLocalizedEmail({
    locale: params.locale ?? defaultLocale,
    subjectEn: `Ticket assigned: ${params.title}`,
    subjectAr: `تم تعيين تذكرة: ${params.title}`,
    titleEn: 'New assignment',
    titleAr: 'تعيين جديد',
    previewEn: `Ticket ${params.ticketId} assigned to you`,
    previewAr: `تم تعيين التذكرة ${params.ticketId} لك`,
    bodyEn: `
      ${p(`You were assigned ticket <strong>${id}</strong>.`)}
      ${p(`<strong>Subject:</strong> ${t}`)}
      ${ccaButton(params.dashboardUrl, 'Open ticket')}
    `,
    bodyAr: `
      ${p(`تم تعيين التذكرة <strong>${id}</strong> لك.`, true)}
      ${p(`<strong>الموضوع:</strong> ${t}`, true)}
      ${ccaButton(params.dashboardUrl, 'فتح التذكرة')}
    `,
    brand: params.brand,
  });
}

export function userInvitedEmail(params: {
  userName: string;
  orgName: string;
  loginUrl: string;
  locale?: EmailLocale;
  brand?: EmailBrandConfig | null;
}) {
  const o = escapeHtml(params.orgName);
  const n = escapeHtml(params.userName || 'there');
  return buildLocalizedEmail({
    locale: params.locale ?? defaultLocale,
    subjectEn: `You were added to ${params.orgName}`,
    subjectAr: `تمت إضافتك إلى ${params.orgName}`,
    titleEn: 'Welcome to the team',
    titleAr: 'مرحباً بك في الفريق',
    previewEn: `Access ${params.orgName} on CCA`,
    previewAr: `الوصول إلى ${params.orgName} على CCA`,
    bodyEn: `
      ${p(`Hello ${n},`)}
      ${p(`You have been added to <strong>${o}</strong>. Sign in to access your workspace.`)}
      ${ccaButton(params.loginUrl, 'Sign in')}
    `,
    bodyAr: `
      ${p(`مرحباً ${n}،`, true)}
      ${p(`تمت إضافتك إلى <strong>${o}</strong>. سجّل الدخول للوصول إلى مساحة العمل.`, true)}
      ${ccaButton(params.loginUrl, 'تسجيل الدخول')}
    `,
    brand: params.brand,
  });
}

export function subscriptionCancelledEmail(params: {
  orgName: string;
  moduleName: string;
  endDate: Date;
  locale?: EmailLocale;
  brand?: EmailBrandConfig | null;
}) {
  const o = escapeHtml(params.orgName);
  const m = escapeHtml(params.moduleName);
  const end = escapeHtml(params.endDate.toLocaleDateString());
  return buildLocalizedEmail({
    locale: params.locale ?? defaultLocale,
    subjectEn: `Subscription cancelled — ${params.moduleName}`,
    subjectAr: `تم إلغاء الاشتراك — ${params.moduleName}`,
    titleEn: 'Subscription cancelled',
    titleAr: 'إلغاء الاشتراك',
    previewEn: `${params.moduleName} subscription ended`,
    previewAr: `انتهى اشتراك ${params.moduleName}`,
    bodyEn: p(`The subscription for <strong>${m}</strong> in <strong>${o}</strong> was cancelled. Access ends on <strong>${end}</strong>.`),
    bodyAr: p(`تم إلغاء اشتراك <strong>${m}</strong> في <strong>${o}</strong>. ينتهي الوصول في <strong>${end}</strong>.`, true),
    brand: params.brand,
  });
}

export function slaDueSoonEmail(params: {
  ticketTitle: string;
  breachType: string;
  ticketUrl: string;
  locale?: EmailLocale;
  brand?: EmailBrandConfig | null;
}) {
  const t = escapeHtml(params.ticketTitle);
  const b = escapeHtml(params.breachType);
  return buildLocalizedEmail({
    locale: params.locale ?? defaultLocale,
    subjectEn: `SLA due soon — ${params.ticketTitle}`,
    subjectAr: `موعد SLA قريب — ${params.ticketTitle}`,
    titleEn: 'SLA reminder',
    titleAr: 'تذكير SLA',
    previewEn: 'A ticket SLA is due within 24 hours',
    previewAr: 'موعد SLA للتذكرة خلال 24 ساعة',
    bodyEn: `
      ${p(`Ticket <strong>${t}</strong> has an upcoming SLA: <strong>${b}</strong>.`)}
      ${ccaButton(params.ticketUrl, 'View ticket')}
    `,
    bodyAr: `
      ${p(`التذكرة <strong>${t}</strong> لديها موعد SLA قريب: <strong>${b}</strong>.`, true)}
      ${ccaButton(params.ticketUrl, 'عرض التذكرة')}
    `,
    brand: params.brand,
  });
}

export function applicationReceivedEmail(params: {
  applicantName: string;
  jobTitle: string;
  locale?: EmailLocale;
  brand?: EmailBrandConfig | null;
}) {
  const n = escapeHtml(params.applicantName);
  const j = escapeHtml(params.jobTitle);
  return buildLocalizedEmail({
    locale: params.locale ?? defaultLocale,
    subjectEn: `Application received — ${params.jobTitle}`,
    subjectAr: `تم استلام طلب التوظيف — ${params.jobTitle}`,
    titleEn: 'Application received',
    titleAr: 'تم استلام الطلب',
    previewEn: 'We received your job application',
    previewAr: 'استلمنا طلب التوظيف',
    bodyEn: p(`Hello ${n}, we received your application for <strong>${j}</strong>. We will review it and get back to you.`),
    bodyAr: p(`مرحباً ${n}، استلمنا طلبك للوظيفة <strong>${j}</strong>. سنراجعه ونتواصل معك.`, true),
    brand: params.brand,
  });
}

export function orgPendingApprovalEmail(params: {
  orgName: string;
  adminEmail: string;
  locale?: EmailLocale;
}) {
  return buildLocalizedEmail({
    locale: params.locale ?? defaultLocale,
    subjectEn: `Organization pending approval — ${params.orgName}`,
    subjectAr: `منظمة بانتظار الموافقة — ${params.orgName}`,
    titleEn: 'Pending approval',
    titleAr: 'بانتظار الموافقة',
    previewEn: 'Your organization is awaiting approval',
    previewAr: 'منظمتك بانتظار الموافقة',
    bodyEn: bilingualParagraph(
      `Your organization <strong>${escapeHtml(params.orgName)}</strong> is pending approval. You will receive an email once it is approved.`,
      `منظمتك <strong>${escapeHtml(params.orgName)}</strong> بانتظار الموافقة. ستصلك رسالة عند الموافقة.`
    ),
    bodyAr: p(`منظمتك <strong>${escapeHtml(params.orgName)}</strong> بانتظار الموافقة. ستصلك رسالة عند الموافقة.`, true),
  });
}

export function loginUrl(): string {
  const base = (process.env.FRONTEND_URL || process.env.CLIENT_URL || 'http://localhost:3000').replace(
    /\/$/,
    ''
  );
  return `${base}/auth/login`;
}
