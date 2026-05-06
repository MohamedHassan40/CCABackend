import { CCA_EMAIL as T } from './branding';

export interface CcaEmailShellOptions {
  /** Shown in inbox preview (hidden in body) */
  previewText: string;
  title: string;
  /** Main HTML fragment (already safe or escaped where needed) */
  innerHtml: string;
}

/**
 * Table-based layout for broad email client support.
 */
export function ccaEmailShell(opts: CcaEmailShellOptions): string {
  const preheader = opts.previewText;
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>${opts.title}</title>
</head>
<body style="margin:0;padding:0;background:${T.background};color:${T.foreground};font-family:'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;">${preheader}</span>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${T.background};padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:${T.card};border-radius:${T.radius};border:1px solid ${T.border};overflow:hidden;box-shadow:0 4px 24px rgba(15,23,42,0.06);">
          <tr>
            <td style="padding:0;background:linear-gradient(135deg,${T.primary} 0%,${T.cloud} 100%);">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="padding:20px 28px;">
                    <p style="margin:0;font-size:20px;font-weight:700;letter-spacing:-0.02em;color:#ffffff;">CCA System</p>
                    <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,0.9);">Cloud Business Platform</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 28px 8px;">
              <h1 style="margin:0 0 16px;font-size:22px;line-height:1.25;color:${T.foreground};">${opts.title}</h1>
              ${opts.innerHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 24px;border-top:1px solid ${T.border};background:${T.background};">
              <p style="margin:0;font-size:12px;line-height:1.5;color:${T.muted};">
                You received this message from <strong style="color:${T.foreground};">CCA System</strong>.
                If you did not expect this email, you can ignore it.
              </p>
            </td>
          </tr>
        </table>
        <p style="margin:16px 0 0;font-size:11px;color:${T.muted};text-align:center;">© ${new Date().getFullYear()} CCA · Secure cloud operations</p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function ccaButton(href: string, label: string): string {
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:20px 0;">
  <tr>
    <td style="border-radius:10px;background:linear-gradient(135deg,${T.primary} 0%,${T.cloudDark} 100%);">
      <a href="${href}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">${label}</a>
    </td>
  </tr>
</table>`;
}

export function ccaMutedBox(html: string): string {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:16px 0;background:${T.cloudMuted};border-radius:10px;border:1px solid ${T.border};">
  <tr><td style="padding:14px 16px;font-size:14px;line-height:1.55;color:${T.foreground};">${html}</td></tr>
</table>`;
}
