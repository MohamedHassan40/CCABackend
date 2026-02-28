/**
 * Sanitize error messages for API responses so we never expose raw DB/stack to clients.
 * Use in catch blocks: res.status(500).json({ error: sanitizeApiError(err) });
 */
export function sanitizeApiError(error: unknown): string {
  if (error == null) return 'Something went wrong';
  const msg = typeof (error as Error).message === 'string' ? (error as Error).message : String(error);
  // Hide Prisma / DB internals
  if (/prisma|invalid.*record|unique constraint|foreign key|P2002|P2003/i.test(msg)) {
    return 'A database constraint was not satisfied. Please check your input.';
  }
  if (/ECONNREFUSED|ETIMEDOUT|connection/i.test(msg)) {
    return 'Service temporarily unavailable. Please try again.';
  }
  // Keep short, known user-facing messages; otherwise generic
  if (msg.length > 200 || /\n|at\s+/.test(msg)) {
    return 'Something went wrong. Please try again.';
  }
  return msg;
}
