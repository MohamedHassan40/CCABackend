import type { Prisma } from '@prisma/client';

export type ParsedEmployeeCode = {
  prefix: string;
  sequence: number;
  padLength: number;
};

/**
 * Parse an employee display ID: fixed prefix + trailing digits (e.g. Emp-01, Employee - 00001).
 */
export function parseEmployeeCode(full: string): ParsedEmployeeCode | null {
  const trimmed = full.trim();
  if (!trimmed) return null;
  const m = trimmed.match(/^(.*?)(\d+)$/);
  if (!m) return null;
  const prefix = m[1];
  const numStr = m[2];
  const sequence = parseInt(numStr, 10);
  if (!Number.isFinite(sequence) || sequence < 0) return null;
  return { prefix, sequence, padLength: numStr.length };
}

export function formatEmployeeCode(prefix: string, sequence: number, padLength: number): string {
  const n = Math.max(0, Math.floor(sequence));
  const numStr = padLength > 0 ? String(n).padStart(padLength, '0') : String(n);
  return `${prefix}${numStr}`;
}

type Tx = Prisma.TransactionClient;

/** Recompute employeeCodeNextSeq from all employees matching the org prefix + pad pattern. */
export async function syncOrgEmployeeCodeSequence(tx: Tx, orgId: string): Promise<void> {
  const org = await tx.organization.findUnique({
    where: { id: orgId },
    select: { employeeCodePrefix: true, employeeCodePadLength: true },
  });
  if (!org?.employeeCodePrefix || org.employeeCodePadLength == null) return;

  const employees = await tx.employee.findMany({
    where: { orgId, employeeCode: { not: null } },
    select: { employeeCode: true },
  });

  let maxSeq = 0;
  for (const e of employees) {
    if (!e.employeeCode) continue;
    const p = parseEmployeeCode(e.employeeCode);
    if (
      p &&
      p.prefix === org.employeeCodePrefix &&
      p.padLength === org.employeeCodePadLength
    ) {
      maxSeq = Math.max(maxSeq, p.sequence);
    }
  }

  await tx.organization.update({
    where: { id: orgId },
    data: { employeeCodeNextSeq: maxSeq + 1 },
  });
}
