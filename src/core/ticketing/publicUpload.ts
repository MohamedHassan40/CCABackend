import multer from 'multer';

export const publicTicketUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 3 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'application/pdf',
      'text/plain',
    ];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Invalid file type'));
  },
});

export async function verifyPublicTicketAccess(
  orgId: string,
  ticketId: string,
  email: string
): Promise<{ id: string; title: string } | null> {
  const prisma = (await import('../db')).default;
  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, orgId },
    select: {
      id: true,
      title: true,
      submittedByEmail: true,
      createdBy: { select: { email: true } },
    },
  });
  if (!ticket) return null;
  const em = email.trim().toLowerCase();
  const ok =
    (ticket.submittedByEmail && ticket.submittedByEmail.toLowerCase() === em) ||
    (ticket.createdBy?.email && ticket.createdBy.email.toLowerCase() === em);
  return ok ? { id: ticket.id, title: ticket.title } : null;
}
