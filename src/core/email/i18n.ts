import type { EmailBrandConfig } from '../auth/magicLink';
import { escapeHtml } from './htmlEscape';
import { CCA_EMAIL as T } from './branding';
import { ccaButton, ccaEmailShell } from './layout';

export type EmailLocale = 'en' | 'ar';

export function normalizeEmailLocale(value?: string | null): EmailLocale {
  if (!value) return 'en';
  const v = value.toLowerCase();
  if (v.startsWith('ar')) return 'ar';
  return 'en';
}

/** Parse Accept-Language header (first preferred). */
export function localeFromAcceptLanguage(header?: string | null): EmailLocale {
  if (!header) return 'en';
  const first = header.split(',')[0]?.trim().split(';')[0]?.trim();
  return normalizeEmailLocale(first);
}

export function pick<T>(locale: EmailLocale, en: T, ar: T): T {
  return locale === 'ar' ? ar : en;
}

function p(text: string, rtl = false): string {
  const dir = rtl ? ' dir="rtl" lang="ar" style="text-align:right;"' : '';
  return `<p${dir} style="margin:0 0 12px;font-size:15px;line-height:1.55;color:${T.foreground};">${text}</p>`;
}

export function bilingualParagraph(en: string, ar: string): string {
  return `${p(en)}${p(ar, true)}`;
}

export function buildLocalizedEmail(opts: {
  locale: EmailLocale;
  subjectEn: string;
  subjectAr: string;
  titleEn: string;
  titleAr: string;
  previewEn: string;
  previewAr: string;
  bodyEn: string;
  bodyAr: string;
  brand?: EmailBrandConfig | null;
}): { subject: string; html: string } {
  const locale = opts.locale;
  const subject = pick(locale, opts.subjectEn, opts.subjectAr);
  const title = pick(locale, opts.titleEn, opts.titleAr);
  const preview = pick(locale, opts.previewEn, opts.previewAr);
  const body = pick(locale, opts.bodyEn, opts.bodyAr);
  return {
    subject,
    html: ccaEmailShell({
      previewText: preview,
      title,
      innerHtml: body,
      brandName: opts.brand?.name,
      brandTagline: opts.brand?.tagline,
      brandPrimaryColor: opts.brand?.primaryColor,
    }),
  };
}

export { escapeHtml, ccaButton, p };
