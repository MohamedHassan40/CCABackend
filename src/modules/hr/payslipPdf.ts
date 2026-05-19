import PDFDocument from 'pdfkit';

export interface PayslipRecordInput {
  employeeName: string;
  employeeEmail: string;
  payPeriodStart: Date;
  payPeriodEnd: Date;
  baseSalary: number;
  allowances: number;
  deductions: number;
  taxAmount: number;
  netSalary: number;
  currency: string;
  status: string;
  paidAt?: Date | null;
}

function formatMoney(cents: number, currency: string): string {
  return `${(cents / 100).toFixed(2)} ${currency}`;
}

export function generatePayslipPdf(record: PayslipRecordInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(20).text('Payslip', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12);
    doc.text(`Employee: ${record.employeeName}`);
    doc.text(`Email: ${record.employeeEmail}`);
    doc.text(
      `Period: ${record.payPeriodStart.toISOString().slice(0, 10)} — ${record.payPeriodEnd.toISOString().slice(0, 10)}`
    );
    doc.text(`Status: ${record.status}`);
    if (record.paidAt) {
      doc.text(`Paid at: ${record.paidAt.toISOString().slice(0, 10)}`);
    }
    doc.moveDown();
    doc.text(`Base salary: ${formatMoney(record.baseSalary, record.currency)}`);
    doc.text(`Allowances: ${formatMoney(record.allowances, record.currency)}`);
    doc.text(`Deductions: ${formatMoney(record.deductions, record.currency)}`);
    doc.text(`Tax: ${formatMoney(record.taxAmount, record.currency)}`);
    doc.moveDown();
    doc.fontSize(14).text(`Net pay: ${formatMoney(record.netSalary, record.currency)}`, { underline: true });
    doc.end();
  });
}
