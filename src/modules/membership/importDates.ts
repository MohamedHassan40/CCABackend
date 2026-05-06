/** Parse dates from CSV/Excel bulk import (ISO, DD/MM/YYYY, Excel serial). */

export function excelSerialToDate(serial: number): Date | null {
  if (!Number.isFinite(serial)) return null;
  const whole = Math.floor(serial);
  if (whole < 20000 || whole > 65000) return null;
  const ms = (whole - 25569) * 86400 * 1000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseImportedDate(raw: unknown): Date | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;

  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = parseFloat(s);
    const d = excelSerialToDate(n);
    if (d) return d;
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s.slice(0, 10) + 'T12:00:00.000Z');
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const dm = s.match(/^(\d{1,2})[\\/.\-](\d{1,2})[\\/.\-](\d{4})/);
  if (dm) {
    const dd = parseInt(dm[1], 10);
    const mm = parseInt(dm[2], 10) - 1;
    const yyyy = parseInt(dm[3], 10);
    const d = new Date(Date.UTC(yyyy, mm, dd, 12, 0, 0));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
