import { Router } from 'express';
import prisma from '../../core/db';
import { requirePermission } from '../../middleware/permissions';

const router = Router();

// GET /api/hr/departments/hierarchy/tree — must be before /:id
router.get('/hierarchy/tree', requirePermission('hr.employees.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const orgId = req.org.id;

    const [deptRows, empRows] = await Promise.all([
      prisma.department.findMany({
        where: { orgId },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
      prisma.employee.findMany({
        where: { orgId },
        select: {
          id: true,
          fullName: true,
          employeeCode: true,
          position: true,
          departmentId: true,
          reportsToId: true,
          photoUrl: true,
        },
        orderBy: { fullName: 'asc' },
      }),
    ]);

    type DeptNode = (typeof deptRows)[0] & {
      children: DeptNode[];
      employees: typeof empRows;
    };
    function nestDept(parentId: string | null): DeptNode[] {
      return deptRows
        .filter((d) => (d.parentDepartmentId ?? null) === parentId)
        .map((d) => ({
          ...d,
          children: nestDept(d.id),
          employees: empRows.filter((e) => e.departmentId === d.id),
        }));
    }
    const departmentTree = nestDept(null);

    const byManager = new Map<string | null, typeof empRows>();
    for (const e of empRows) {
      const k = e.reportsToId ?? null;
      if (!byManager.has(k)) byManager.set(k, []);
      byManager.get(k)!.push(e);
    }

    type RepNode = (typeof empRows)[0] & { directReports: RepNode[] };
    function buildReporting(managerId: string | null): RepNode[] {
      const list = byManager.get(managerId) ?? [];
      return list.map((e) => ({
        ...e,
        directReports: buildReporting(e.id),
      }));
    }
    const reportingTree = buildReporting(null);

    res.json({
      departmentTree,
      reportingTree,
    });
  } catch (e) {
    console.error('hierarchy tree', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/hr/departments — list departments (flat)
router.get('/', requirePermission('hr.employees.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const rows = await prisma.department.findMany({
      where: { orgId: req.org.id },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    res.json(rows);
  } catch (e) {
    console.error('departments list', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/hr/departments
router.post('/', requirePermission('hr.employees.edit'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const orgId = req.org.id;
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (!name) {
      res.status(400).json({ error: 'Department name is required' });
      return;
    }
    const description =
      typeof req.body.description === 'string' ? req.body.description.trim() || null : null;
    const parentDepartmentId =
      typeof req.body.parentDepartmentId === 'string' && req.body.parentDepartmentId.trim()
        ? req.body.parentDepartmentId.trim()
        : null;
    const sortOrder =
      typeof req.body.sortOrder === 'number' && Number.isFinite(req.body.sortOrder)
        ? Math.floor(req.body.sortOrder)
        : 0;

    if (parentDepartmentId) {
      const parent = await prisma.department.findFirst({
        where: { id: parentDepartmentId, orgId },
      });
      if (!parent) {
        res.status(400).json({ error: 'Invalid parent department' });
        return;
      }
    }

    const created = await prisma.department.create({
      data: {
        orgId,
        name,
        description,
        parentDepartmentId,
        sortOrder,
      },
    });
    res.status(201).json(created);
  } catch (e) {
    console.error('departments create', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/hr/departments/:id
router.put('/:id', requirePermission('hr.employees.edit'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const orgId = req.org.id;
    const { id } = req.params;
    const existing = await prisma.department.findFirst({ where: { id, orgId } });
    if (!existing) {
      res.status(404).json({ error: 'Department not found' });
      return;
    }

    const name =
      req.body.name !== undefined
        ? typeof req.body.name === 'string'
          ? req.body.name.trim()
          : ''
        : existing.name;
    if (!name) {
      res.status(400).json({ error: 'Department name is required' });
      return;
    }

    let parentDepartmentId = existing.parentDepartmentId;
    if (req.body.parentDepartmentId !== undefined) {
      parentDepartmentId =
        typeof req.body.parentDepartmentId === 'string' && req.body.parentDepartmentId.trim()
          ? req.body.parentDepartmentId.trim()
          : null;
    }
    if (parentDepartmentId === id) {
      res.status(400).json({ error: 'Department cannot be its own parent' });
      return;
    }
    if (parentDepartmentId) {
      const parent = await prisma.department.findFirst({
        where: { id: parentDepartmentId, orgId },
      });
      if (!parent) {
        res.status(400).json({ error: 'Invalid parent department' });
        return;
      }
      // Prevent choosing a parent that is this department or one of its descendants (walk up from parent)
      let walk: string | null = parentDepartmentId;
      const seen = new Set<string>();
      for (let i = 0; i < 200; i++) {
        if (!walk) break;
        if (walk === id) {
          res.status(400).json({ error: 'Cannot set parent to a sub-department of this department' });
          return;
        }
        if (seen.has(walk)) break;
        seen.add(walk);
        const parentRow: { parentDepartmentId: string | null } | null = await prisma.department.findFirst({
          where: { id: walk, orgId },
          select: { parentDepartmentId: true },
        });
        walk = parentRow?.parentDepartmentId ?? null;
      }
    }

    const description =
      req.body.description !== undefined
        ? typeof req.body.description === 'string'
          ? req.body.description.trim() || null
          : null
        : existing.description;
    const sortOrder =
      typeof req.body.sortOrder === 'number' && Number.isFinite(req.body.sortOrder)
        ? Math.floor(req.body.sortOrder)
        : existing.sortOrder;

    const updated = await prisma.department.update({
      where: { id },
      data: { name, description, parentDepartmentId, sortOrder },
    });
    res.json(updated);
  } catch (e) {
    console.error('departments update', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/hr/departments/:id
router.delete('/:id', requirePermission('hr.employees.edit'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const orgId = req.org.id;
    const { id } = req.params;
    const existing = await prisma.department.findFirst({ where: { id, orgId } });
    if (!existing) {
      res.status(404).json({ error: 'Department not found' });
      return;
    }
    const childCount = await prisma.department.count({
      where: { orgId, parentDepartmentId: id },
    });
    if (childCount > 0) {
      res.status(400).json({ error: 'Remove or move sub-departments first' });
      return;
    }
    const empCount = await prisma.employee.count({
      where: { orgId, departmentId: id },
    });
    if (empCount > 0) {
      res.status(400).json({ error: 'Reassign employees before deleting this department' });
      return;
    }
    await prisma.department.delete({ where: { id } });
    res.json({ message: 'Department deleted' });
  } catch (e) {
    console.error('departments delete', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
