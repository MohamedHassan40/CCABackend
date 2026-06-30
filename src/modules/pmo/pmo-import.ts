import prisma from '../../core/db';

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur.trim());
  return result;
}

function parseCsv(text: string): string[][] {
  return text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map(parseCsvLine);
}

export async function importTasksFromCsv(
  projectId: string,
  orgId: string,
  userId: string,
  csvText: string,
): Promise<{ created: number; errors: string[] }> {
  const rows = parseCsv(csvText);
  if (rows.length < 2) return { created: 0, errors: ['CSV must include header and at least one row'] };

  const header = rows[0].map((h) => h.toLowerCase());
  const titleIdx = header.indexOf('title');
  if (titleIdx < 0) return { created: 0, errors: ['Missing required column: title'] };

  const descIdx = header.indexOf('description');
  const statusIdx = header.indexOf('status');
  const priorityIdx = header.indexOf('priority');
  const dueIdx = header.indexOf('duedate') >= 0 ? header.indexOf('duedate') : header.indexOf('due_date');

  let created = 0;
  const errors: string[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const title = row[titleIdx]?.trim();
    if (!title) {
      errors.push(`Row ${i + 1}: missing title`);
      continue;
    }
    try {
      await prisma.projectTask.create({
        data: {
          projectId,
          orgId,
          title,
          description: descIdx >= 0 ? row[descIdx] || null : null,
          status: statusIdx >= 0 ? row[statusIdx] || 'submitted' : 'submitted',
          priority: priorityIdx >= 0 ? row[priorityIdx] || 'medium' : 'medium',
          dueDate: dueIdx >= 0 && row[dueIdx] ? new Date(row[dueIdx]) : null,
          createdById: userId,
          createdByType: 'org_user',
        },
      });
      created++;
    } catch (e) {
      errors.push(`Row ${i + 1}: ${e instanceof Error ? e.message : 'failed'}`);
    }
  }

  return { created, errors };
}

export async function importMilestonesFromCsv(
  projectId: string,
  csvText: string,
): Promise<{ created: number; errors: string[] }> {
  const rows = parseCsv(csvText);
  if (rows.length < 2) return { created: 0, errors: ['CSV must include header and at least one row'] };

  const header = rows[0].map((h) => h.toLowerCase());
  const nameIdx = header.indexOf('name');
  const dateIdx = header.indexOf('targetdate') >= 0 ? header.indexOf('targetdate') : header.indexOf('target_date');
  if (nameIdx < 0 || dateIdx < 0) {
    return { created: 0, errors: ['Required columns: name, targetDate'] };
  }

  const descIdx = header.indexOf('description');
  const statusIdx = header.indexOf('status');

  let created = 0;
  const errors: string[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const name = row[nameIdx]?.trim();
    const targetDate = row[dateIdx]?.trim();
    if (!name || !targetDate) {
      errors.push(`Row ${i + 1}: missing name or targetDate`);
      continue;
    }
    try {
      await prisma.projectMilestone.create({
        data: {
          projectId,
          name,
          targetDate: new Date(targetDate),
          description: descIdx >= 0 ? row[descIdx] || null : null,
          status: statusIdx >= 0 ? row[statusIdx] || 'pending' : 'pending',
        },
      });
      created++;
    } catch (e) {
      errors.push(`Row ${i + 1}: ${e instanceof Error ? e.message : 'failed'}`);
    }
  }

  return { created, errors };
}
