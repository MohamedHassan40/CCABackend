// Moyasar payment integration
// Invoices (hosted checkout): https://docs.moyasar.com/api/invoices/01-create-invoice/
// Payments: https://api.moyasar.com/v1/payments

import axios, { type AxiosError } from 'axios';
import { randomUUID } from 'crypto';

const MOYASAR_SECRET_KEY = process.env.MOYASAR_SECRET_KEY || '';
const MOYASAR_PUBLISHABLE_KEY = process.env.MOYASAR_PUBLISHABLE_KEY || process.env.MOYASAR_PUBLIC_KEY || '';

/** Invoice statuses from Moyasar Invoice API */
export type MoyasarInvoiceStatus =
  | 'initiated'
  | 'paid'
  | 'failed'
  | 'refunded'
  | 'canceled'
  | 'on_hold'
  | 'expired'
  | 'voided';

/** Payment statuses from Moyasar Payments API */
export type MoyasarPaymentStatus =
  | 'initiated'
  | 'paid'
  | 'authorized'
  | 'failed'
  | 'refunded'
  | 'captured'
  | 'voided'
  | 'verified';

export interface MoyasarInvoice {
  id: string;
  status?: MoyasarInvoiceStatus;
  amount: number;
  currency?: string;
  description?: string;
  created_at?: string;
  updated_at?: string;
  expired_at?: string | null;
  success_url?: string;
  back_url?: string;
  callback_url?: string;
  metadata?: Record<string, unknown>;
  /** Hosted checkout page (current Moyasar API) */
  url?: string;
  /** Legacy/alternate field name */
  invoice_url?: string;
  amount_format?: string;
  logo_url?: string;
  payments?: unknown[];
}

export interface MoyasarCreditCardSource {
  type: 'creditcard';
  name: string;
  number: string;
  month: number;
  year: number;
  cvc: number | string;
  statement_descriptor?: string;
  '3ds'?: boolean;
  manual?: boolean;
  save_card?: boolean;
}

export interface MoyasarPaymentRecord {
  id: string;
  status: MoyasarPaymentStatus;
  amount: number;
  fee?: number;
  currency: string;
  refunded?: number;
  captured?: number;
  description?: string;
  invoice_id?: string;
  callback_url?: string;
  metadata?: Record<string, unknown>;
  source?: Record<string, unknown>;
  created_at: string;
  updated_at?: string;
  amount_format?: string;
  fee_format?: string;
}

export interface PaymentIntent {
  amount: number;
  currency: string;
  description: string;
  metadata?: Record<string, string>;
  success_url?: string;
  back_url?: string;
  callback_url?: string;
  expired_at?: string;
}

export interface PaymentResult {
  id: string;
  status: 'paid' | 'failed' | 'authorized';
  amount: number;
  currency: string;
  description?: string;
  metadata?: Record<string, string>;
}

export interface CreatePaymentParams {
  /** Client-generated UUID for idempotency; becomes the payment id when omitted a new one is generated */
  given_id?: string;
  amount: number;
  currency: string;
  description?: string;
  callback_url?: string;
  source: MoyasarCreditCardSource | Record<string, unknown>;
  metadata?: Record<string, unknown>;
  apply_coupon?: boolean;
  splits?: unknown[];
}

function moyasarErrorMessage(error: unknown): string {
  const ax = error as AxiosError<{ message?: string; errors?: unknown }>;
  const data = ax.response?.data;
  if (data && typeof data === 'object' && 'message' in data && typeof data.message === 'string') {
    return data.message;
  }
  if (ax.message) return ax.message;
  return 'Moyasar request failed';
}

/** Hosted invoice checkout URL from create/fetch invoice responses */
export function getInvoiceCheckoutUrl(invoice: MoyasarInvoice): string | undefined {
  return invoice.url ?? invoice.invoice_url ?? undefined;
}

class MoyasarService {
  private apiKey: string;
  private baseUrl: string;

  constructor() {
    this.apiKey = MOYASAR_SECRET_KEY;
    this.baseUrl = 'https://api.moyasar.com/v1';
  }

  private getAuthHeaders(): Record<string, string> {
    return {
      Authorization: `Basic ${Buffer.from(`${this.apiKey}:`).toString('base64')}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
  }

  /**
   * Create a Moyasar e-invoice (hosted checkout). Requires currency per API.
   */
  async createInvoice(invoiceData: {
    amount: number;
    currency: string;
    description: string;
    expired_at?: string;
    success_url?: string;
    back_url?: string;
    callback_url?: string;
    metadata?: Record<string, unknown>;
  }): Promise<MoyasarInvoice> {
    if (!this.apiKey) {
      throw new Error('Moyasar API key not configured');
    }
    try {
      const response = await axios.post<MoyasarInvoice>(`${this.baseUrl}/invoices`, invoiceData, {
        headers: this.getAuthHeaders(),
      });
      return response.data;
    } catch (error: unknown) {
      console.error('Error creating Moyasar invoice:', (error as AxiosError).response?.data || error);
      throw new Error(moyasarErrorMessage(error));
    }
  }

  async getInvoiceById(invoiceId: string): Promise<MoyasarInvoice> {
    if (!this.apiKey) {
      throw new Error('Moyasar API key not configured');
    }
    try {
      const response = await axios.get<MoyasarInvoice>(`${this.baseUrl}/invoices/${invoiceId}`, {
        headers: this.getAuthHeaders(),
      });
      return response.data;
    } catch (error: unknown) {
      console.error('Error fetching Moyasar invoice:', (error as AxiosError).response?.data || error);
      throw new Error(moyasarErrorMessage(error));
    }
  }

  /**
   * POST /payments — card / token / wallet flows (see Moyasar Payments API).
   * Ensure PCI compliance: prefer token/source from Moyasar.js on the client when possible.
   */
  async createPayment(params: CreatePaymentParams): Promise<MoyasarPaymentRecord> {
    if (!this.apiKey) {
      throw new Error('Moyasar API key not configured');
    }
    const body = {
      given_id: params.given_id ?? randomUUID(),
      amount: params.amount,
      currency: params.currency,
      ...(params.description !== undefined && { description: params.description }),
      ...(params.callback_url !== undefined && { callback_url: params.callback_url }),
      source: params.source,
      ...(params.metadata !== undefined && { metadata: params.metadata }),
      ...(params.apply_coupon !== undefined && { apply_coupon: params.apply_coupon }),
      ...(params.splits !== undefined && { splits: params.splits }),
    };
    try {
      const response = await axios.post<MoyasarPaymentRecord>(`${this.baseUrl}/payments`, body, {
        headers: this.getAuthHeaders(),
      });
      return response.data;
    } catch (error: unknown) {
      console.error('Error creating Moyasar payment:', (error as AxiosError).response?.data || error);
      throw new Error(moyasarErrorMessage(error));
    }
  }

  async getPaymentById(paymentId: string): Promise<MoyasarPaymentRecord> {
    if (!this.apiKey) {
      throw new Error('Moyasar API key not configured');
    }
    try {
      const response = await axios.get<MoyasarPaymentRecord>(`${this.baseUrl}/payments/${paymentId}`, {
        headers: this.getAuthHeaders(),
      });
      return response.data;
    } catch (error: unknown) {
      console.error('Error fetching Moyasar payment:', (error as AxiosError).response?.data || error);
      throw new Error(moyasarErrorMessage(error));
    }
  }

  async updatePayment(
    paymentId: string,
    body: { description?: string; metadata?: Record<string, unknown> }
  ): Promise<MoyasarPaymentRecord> {
    if (!this.apiKey) {
      throw new Error('Moyasar API key not configured');
    }
    try {
      const response = await axios.put<MoyasarPaymentRecord>(`${this.baseUrl}/payments/${paymentId}`, body, {
        headers: this.getAuthHeaders(),
      });
      return response.data;
    } catch (error: unknown) {
      console.error('Error updating Moyasar payment:', (error as AxiosError).response?.data || error);
      throw new Error(moyasarErrorMessage(error));
    }
  }

  async refundPayment(paymentId: string, body: { amount?: number } = {}): Promise<MoyasarPaymentRecord> {
    if (!this.apiKey) {
      throw new Error('Moyasar API key not configured');
    }
    try {
      const response = await axios.post<MoyasarPaymentRecord>(
        `${this.baseUrl}/payments/${paymentId}/refund`,
        Object.keys(body).length ? body : {},
        { headers: this.getAuthHeaders() }
      );
      return response.data;
    } catch (error: unknown) {
      console.error('Error refunding Moyasar payment:', (error as AxiosError).response?.data || error);
      throw new Error(moyasarErrorMessage(error));
    }
  }

  async capturePayment(paymentId: string, body: { amount?: number } = {}): Promise<MoyasarPaymentRecord> {
    if (!this.apiKey) {
      throw new Error('Moyasar API key not configured');
    }
    try {
      const response = await axios.post<MoyasarPaymentRecord>(
        `${this.baseUrl}/payments/${paymentId}/capture`,
        Object.keys(body).length ? body : {},
        { headers: this.getAuthHeaders() }
      );
      return response.data;
    } catch (error: unknown) {
      console.error('Error capturing Moyasar payment:', (error as AxiosError).response?.data || error);
      throw new Error(moyasarErrorMessage(error));
    }
  }

  async voidPayment(paymentId: string): Promise<MoyasarPaymentRecord> {
    if (!this.apiKey) {
      throw new Error('Moyasar API key not configured');
    }
    try {
      const response = await axios.post<MoyasarPaymentRecord>(
        `${this.baseUrl}/payments/${paymentId}/void`,
        {},
        { headers: this.getAuthHeaders() }
      );
      return response.data;
    } catch (error: unknown) {
      console.error('Error voiding Moyasar payment:', (error as AxiosError).response?.data || error);
      throw new Error(moyasarErrorMessage(error));
    }
  }

  async verifyPayment(paymentId: string): Promise<PaymentResult> {
    const payment = await this.getPaymentById(paymentId);
    let status: PaymentResult['status'] = 'failed';
    if (payment.status === 'paid' || payment.status === 'verified' || payment.status === 'captured') {
      status = 'paid';
    } else if (payment.status === 'authorized') {
      status = 'authorized';
    }
    const meta = payment.metadata;
    const flatMeta =
      meta && typeof meta === 'object'
        ? Object.fromEntries(Object.entries(meta).map(([k, v]) => [k, String(v)]))
        : undefined;
    return {
      id: payment.id,
      status,
      amount: payment.amount,
      currency: payment.currency,
      description: payment.description,
      metadata: flatMeta,
    };
  }

  getPublicKey(): string {
    if (!MOYASAR_PUBLISHABLE_KEY) {
      throw new Error('Moyasar public key not configured');
    }
    return MOYASAR_PUBLISHABLE_KEY;
  }

  async getInvoices(page: number = 1, perPage: number = 50): Promise<{
    invoices: MoyasarInvoice[];
    total?: number;
    page?: number;
    per_page?: number;
    meta?: Record<string, unknown>;
  }> {
    if (!this.apiKey) {
      throw new Error('Moyasar API key not configured');
    }
    try {
      const response = await axios.get(`${this.baseUrl}/invoices`, {
        headers: this.getAuthHeaders(),
        params: { page, per_page: perPage },
      });
      const data = response.data as {
        invoices?: MoyasarInvoice[];
        meta?: Record<string, unknown>;
        total?: number;
        page?: number;
        per_page?: number;
      };
      return {
        invoices: data.invoices ?? [],
        total: data.total,
        page: data.page ?? page,
        per_page: data.per_page ?? perPage,
        meta: data.meta,
      };
    } catch (error: unknown) {
      console.error('Error fetching Moyasar invoices:', (error as AxiosError).response?.data || error);
      throw new Error('Failed to fetch invoices from Moyasar');
    }
  }

  /**
   * GET /payments — list payments (see API query params).
   */
  async listPayments(params?: {
    page?: number;
    id?: string;
    status?: MoyasarPaymentStatus;
    createdGt?: string;
    createdLt?: string;
    updatedGt?: string;
    updatedLt?: string;
    cardLastDigits?: string;
    receiptNo?: string;
    metadata?: Record<string, string>;
  }): Promise<{ payments: MoyasarPaymentRecord[]; meta?: Record<string, unknown> }> {
    if (!this.apiKey) {
      throw new Error('Moyasar API key not configured');
    }
    const query: Record<string, string | number | undefined> = {
      page: params?.page ?? 1,
      id: params?.id,
      status: params?.status,
      'created[gt]': params?.createdGt,
      'created[lt]': params?.createdLt,
      'updated[gt]': params?.updatedGt,
      'updated[lt]': params?.updatedLt,
      card_last_digits: params?.cardLastDigits,
      receipt_no: params?.receiptNo,
    };
    if (params?.metadata) {
      for (const [key, value] of Object.entries(params.metadata)) {
        query[`metadata[${key}]`] = value;
      }
    }
    try {
      const response = await axios.get<{ payments?: MoyasarPaymentRecord[]; meta?: Record<string, unknown> }>(
        `${this.baseUrl}/payments`,
        {
          headers: this.getAuthHeaders(),
          params: query,
        }
      );
      return {
        payments: response.data.payments ?? [],
        meta: response.data.meta,
      };
    } catch (error: unknown) {
      console.error('Error listing Moyasar payments:', (error as AxiosError).response?.data || error);
      throw new Error('Failed to fetch payments from Moyasar');
    }
  }

  /** @deprecated Prefer listPayments(); kept for backward compatibility */
  async getPayments(page: number = 1, _perPage: number = 50): Promise<{
    payments: MoyasarPaymentRecord[];
    pagination: {
      page: number;
      per_page: number;
      total: number;
      total_pages: number;
    };
    meta?: Record<string, unknown>;
  }> {
    const { payments, meta } = await this.listPayments({ page });
    const currentPage =
      typeof meta?.current_page === 'number'
        ? meta.current_page
        : typeof meta?.page === 'number'
          ? meta.page
          : page;
    const total =
      typeof meta?.total === 'number'
        ? meta.total
        : typeof meta?.total_count === 'number'
          ? meta.total_count
          : payments.length;
    const totalPages =
      typeof meta?.total_pages === 'number'
        ? meta.total_pages
        : typeof meta?.last_page === 'number'
          ? meta.last_page
          : 1;
    const perPage =
      typeof meta?.per_page === 'number'
        ? meta.per_page
        : typeof meta?.limit === 'number'
          ? meta.limit
          : _perPage;
    return {
      payments,
      meta,
      pagination: {
        page: currentPage,
        per_page: perPage,
        total,
        total_pages: totalPages,
      },
    };
  }
}

export const moyasarService = new MoyasarService();

export async function createPaymentIntent(intent: PaymentIntent): Promise<MoyasarInvoice> {
  return moyasarService.createInvoice({
    amount: intent.amount,
    currency: intent.currency,
    description: intent.description,
    metadata: intent.metadata,
    success_url: intent.success_url,
    back_url: intent.back_url,
    callback_url: intent.callback_url,
    expired_at: intent.expired_at,
  });
}

export async function verifyPayment(paymentId: string): Promise<PaymentResult> {
  return moyasarService.verifyPayment(paymentId);
}

export function getPublicKey(): string {
  return moyasarService.getPublicKey();
}
