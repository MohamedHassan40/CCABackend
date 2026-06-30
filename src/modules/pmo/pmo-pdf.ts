import PDFDocument from 'pdfkit';

function formatMoney(cents: number, currency: string): string {
  return `${(cents / 100).toFixed(2)} ${currency}`;
}

function pdfBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

export async function generateExecutiveSummaryPdf(data: {
  projectName: string;
  orgName: string;
  summary: Record<string, unknown>;
  items: Array<{ name: string; type: string; progress: number; status: string; responsible?: string | null }>;
}): Promise<Buffer> {
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  const bufPromise = pdfBuffer(doc);

  doc.fontSize(18).text('Executive Plan Summary', { align: 'center' });
  doc.moveDown(0.5);
  doc.fontSize(11).fillColor('#555').text(`${data.orgName} — ${data.projectName}`, { align: 'center' });
  doc.moveDown();
  doc.fillColor('#000').fontSize(12);

  const s = data.summary;
  doc.text(`Total tasks: ${s.totalTasks ?? 0}`);
  doc.text(`Deliverables: ${s.totalOutputs ?? 0}`);
  doc.text(`Avg. completion: ${s.avgCompletion ?? 0}%`);
  doc.text(`Budget spent: ${s.spendPercent ?? 0}%`);
  if (s.budgetCents != null) {
    doc.text(`Budget: ${formatMoney(Number(s.budgetCents), String(s.currency ?? 'SAR'))}`);
    doc.text(`Spent: ${formatMoney(Number(s.spentCents ?? 0), String(s.currency ?? 'SAR'))}`);
  }
  doc.moveDown();

  doc.fontSize(14).text('Plan Items', { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(10);
  for (const item of data.items.slice(0, 80)) {
    doc.text(`• ${item.name} (${item.type}) — ${item.progress}% — ${item.status}${item.responsible ? ` — ${item.responsible}` : ''}`);
  }
  if (data.items.length > 80) {
    doc.text(`… and ${data.items.length - 80} more items`);
  }

  doc.end();
  return bufPromise;
}

export async function generateClosureCertificatePdf(data: {
  projectName: string;
  orgName: string;
  certificateNumber: string;
  generatedAt: Date;
  finalReport?: string | null;
}): Promise<Buffer> {
  const doc = new PDFDocument({ margin: 60, size: 'A4' });
  const bufPromise = pdfBuffer(doc);

  doc.fontSize(22).text('Project Completion Certificate', { align: 'center' });
  doc.moveDown(2);
  doc.fontSize(12).text(`This certifies that the project "${data.projectName}" managed by ${data.orgName} has completed its closure process.`, {
    align: 'center',
  });
  doc.moveDown(2);
  doc.text(`Certificate No: ${data.certificateNumber}`, { align: 'center' });
  doc.text(`Date: ${data.generatedAt.toISOString().slice(0, 10)}`, { align: 'center' });
  if (data.finalReport) {
    doc.moveDown(2);
    doc.fontSize(11).text('Summary', { underline: true });
    doc.text(String(data.finalReport).slice(0, 2000));
  }

  doc.end();
  return bufPromise;
}

export async function generateProjectReportPdf(data: {
  projectName: string;
  orgName: string;
  reportType: string;
  report: Record<string, unknown>;
}): Promise<Buffer> {
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  const bufPromise = pdfBuffer(doc);

  doc.fontSize(18).text(`${data.reportType} Report`, { align: 'center' });
  doc.moveDown();
  doc.fontSize(12).text(`Project: ${data.projectName}`);
  doc.text(`Organization: ${data.orgName}`);
  doc.moveDown();

  const walk = (obj: Record<string, unknown>, indent = 0) => {
    for (const [k, v] of Object.entries(obj)) {
      if (v == null || k === 'id') continue;
      if (typeof v === 'object' && !Array.isArray(v)) {
        doc.text(`${'  '.repeat(indent)}${k}:`);
        walk(v as Record<string, unknown>, indent + 1);
      } else {
        doc.text(`${'  '.repeat(indent)}${k}: ${String(v).slice(0, 500)}`);
      }
    }
  };
  walk(data.report);

  doc.end();
  return bufPromise;
}
