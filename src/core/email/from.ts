/**
 * Default “From” for SendGrid: display name + verified sender address.
 * Set SENDGRID_FROM_EMAIL and optional SENDGRID_FROM_NAME (default: CCA System).
 */
export function getSendGridFrom(): { email: string; name: string } {
  const email = process.env.SENDGRID_FROM_EMAIL?.trim() || 'noreply@cloudorg.com';
  const name = process.env.SENDGRID_FROM_NAME?.trim() || 'CCA System';
  return { email, name };
}
