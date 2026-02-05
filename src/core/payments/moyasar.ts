// Moyasar payment integration
// Documentation: https://moyasar.com/docs/api/

import axios from 'axios';

const MOYASAR_SECRET_KEY = process.env.MOYASAR_SECRET_KEY || '';
const MOYASAR_PUBLISHABLE_KEY = process.env.MOYASAR_PUBLISHABLE_KEY || process.env.MOYASAR_PUBLIC_KEY || '';

export interface MoyasarInvoice {
  id: string;
  amount: number; // in halalas
  status: 'paid' | 'unpaid' | 'expired' | 'refunded';
  method?: 'creditcard' | 'stcpay' | 'applepay' | 'mada';
  description: string;
  created_at: string;
  paid_at?: string;
  expired_at?: string;
  success_url?: string;
  back_url?: string;
  callback_url?: string;
  metadata?: Record<string, any>;
  invoice_url?: string;
  source?: {
    type: string;
    company: string;
    name: string;
    number: string;
    gateway_id: string;
    reference_number: string;
    token: string;
    message?: string;
    transaction_url?: string;
  };
}

export interface MoyasarPayment {
  id: string;
  amount: number; // in halalas
  currency: string;
  status: 'paid' | 'failed' | 'authorized';
  description: string;
  created_at: string;
  metadata?: Record<string, any>;
}

export interface PaymentIntent {
  amount: number; // in cents/halalas
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
  description: string;
  metadata?: Record<string, string>;
}

class MoyasarService {
  private apiKey: string;
  private baseUrl: string;

  constructor() {
    this.apiKey = MOYASAR_SECRET_KEY;
    this.baseUrl = 'https://api.moyasar.com/v1';
  }

  private getHeaders() {
    return {
      'Authorization': `Basic ${Buffer.from(this.apiKey + ':').toString('base64')}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Create a payment invoice with Moyasar
   * Returns invoice URL for redirect
   */
  async createInvoice(invoiceData: {
    amount: number; // in halalas
    description: string;
    expired_at?: string;
    success_url?: string;
    back_url?: string;
    callback_url?: string;
    metadata?: Record<string, any>;
  }): Promise<MoyasarInvoice> {
    try {
      if (!this.apiKey) {
        throw new Error('Moyasar API key not configured');
      }

      const response = await axios.post(`${this.baseUrl}/invoices`, invoiceData, {
        headers: this.getHeaders(),
      });

      return response.data;
    } catch (error: any) {
      console.error('Error creating Moyasar invoice:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || 'Failed to create invoice in Moyasar');
    }
  }

  /**
   * Get invoice by ID
   */
  async getInvoiceById(invoiceId: string): Promise<MoyasarInvoice> {
    try {
      if (!this.apiKey) {
        throw new Error('Moyasar API key not configured');
      }

      const response = await axios.get(`${this.baseUrl}/invoices/${invoiceId}`, {
        headers: this.getHeaders(),
      });

      return response.data;
    } catch (error: any) {
      console.error('Error fetching Moyasar invoice:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || 'Failed to fetch invoice from Moyasar');
    }
  }

  /**
   * Get payment by ID
   */
  async getPaymentById(paymentId: string): Promise<MoyasarPayment> {
    try {
      if (!this.apiKey) {
        throw new Error('Moyasar API key not configured');
      }

      const response = await axios.get(`${this.baseUrl}/payments/${paymentId}`, {
        headers: this.getHeaders(),
      });

      return response.data;
    } catch (error: any) {
      console.error('Error fetching Moyasar payment:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || 'Failed to fetch payment from Moyasar');
    }
  }

  /**
   * Verify a payment with Moyasar
   */
  async verifyPayment(paymentId: string): Promise<PaymentResult> {
    try {
      const payment = await this.getPaymentById(paymentId);
      
      return {
        id: payment.id,
        status: payment.status === 'paid' ? 'paid' : payment.status === 'authorized' ? 'authorized' : 'failed',
        amount: payment.amount,
        currency: payment.currency,
        description: payment.description,
        metadata: payment.metadata,
      };
    } catch (error: any) {
      console.error('Error verifying payment:', error);
      throw error;
    }
  }

  /**
   * Get Moyasar public key for frontend
   */
  getPublicKey(): string {
    if (!MOYASAR_PUBLISHABLE_KEY) {
      throw new Error('Moyasar public key not configured');
    }
    return MOYASAR_PUBLISHABLE_KEY;
  }

  /**
   * Get invoices list
   */
  async getInvoices(page: number = 1, perPage: number = 50): Promise<{
    invoices: MoyasarInvoice[];
    total: number;
    page: number;
    per_page: number;
  }> {
    try {
      if (!this.apiKey) {
        throw new Error('Moyasar API key not configured');
      }

      const response = await axios.get(`${this.baseUrl}/invoices`, {
        headers: this.getHeaders(),
        params: {
          page,
          per_page: perPage,
        },
      });

      return response.data;
    } catch (error: any) {
      console.error('Error fetching Moyasar invoices:', error.response?.data || error.message);
      throw new Error('Failed to fetch invoices from Moyasar');
    }
  }

  /**
   * Get payments list
   */
  async getPayments(page: number = 1, perPage: number = 50): Promise<{
    payments: MoyasarPayment[];
    pagination: {
      page: number;
      per_page: number;
      total: number;
      total_pages: number;
    };
  }> {
    try {
      const response = await axios.get(`${this.baseUrl}/payments`, {
        headers: this.getHeaders(),
        params: {
          page,
          per_page: perPage,
        },
      });

      return {
        payments: response.data.payments || [],
        pagination: {
          page: response.data.page || page,
          per_page: response.data.per_page || perPage,
          total: response.data.total || 0,
          total_pages: response.data.total_pages || 0,
        },
      };
    } catch (error: any) {
      console.error('Error fetching Moyasar payments:', error.response?.data || error.message);
      throw new Error('Failed to fetch payments from Moyasar');
    }
  }
}

// Export singleton instance
export const moyasarService = new MoyasarService();

// Export convenience functions for backward compatibility
export async function createPaymentIntent(intent: PaymentIntent): Promise<MoyasarInvoice> {
  return moyasarService.createInvoice({
    amount: intent.amount,
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
