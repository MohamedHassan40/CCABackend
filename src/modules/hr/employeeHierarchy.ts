import prisma from '../../core/db';

/** True if assigning `employeeId` to report to `startManagerId` creates a cycle. */
export async function reportingLineWouldCycle(
  orgId: string,
  employeeId: string,
  startManagerId: string | null
): Promise<boolean> {
  if (!startManagerId) return false;
  if (startManagerId === employeeId) return true;

  let current: string | null = startManagerId;
  const seen = new Set<string>();
  for (let i = 0; i < 500; i++) {
    if (!current) return false;
    if (current === employeeId) return true;
    if (seen.has(current)) return true;
    seen.add(current);
    const empRow: { reportsToId: string | null } | null = await prisma.employee.findFirst({
      where: { id: current, orgId },
      select: { reportsToId: true },
    });
    current = empRow?.reportsToId ?? null;
  }
  return true;
}

export async function assertDepartmentInOrg(
  orgId: string,
  departmentId: string | null | undefined
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!departmentId) return { ok: true };
  const d = await prisma.department.findFirst({
    where: { id: departmentId, orgId },
    select: { id: true },
  });
  if (!d) {
    return { ok: false, status: 400, error: 'Invalid department' };
  }
  return { ok: true };
}

export async function assertManagerInOrg(
  orgId: string,
  managerId: string | null | undefined,
  employeeId?: string | null
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!managerId) return { ok: true };
  if (employeeId && managerId === employeeId) {
    return { ok: false, status: 400, error: 'An employee cannot be their own manager' };
  }
  const m = await prisma.employee.findFirst({
    where: { id: managerId, orgId },
    select: { id: true },
  });
  if (!m) {
    return { ok: false, status: 400, error: 'Invalid reporting manager' };
  }
  if (employeeId) {
    const cycle = await reportingLineWouldCycle(orgId, employeeId, managerId);
    if (cycle) {
      return { ok: false, status: 400, error: 'That reporting line would create a cycle' };
    }
  }
  return { ok: true };
}
