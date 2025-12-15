/**
 * Lulu Print-on-Demand API Client for Workers
 *
 * Handles OAuth 2.0 authentication and API calls to Lulu's print service.
 * This is a copy of apps/api/src/lib/lulu/client.ts adapted for workers.
 * Documentation: https://developers.lulu.com/
 */

import { LULU_CONFIG } from '@storywink/shared/lulu';

// Types for Lulu API responses
export interface LuluToken {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface LuluShippingAddress {
  name: string;
  street1: string;
  street2?: string;
  city: string;
  state_code?: string;
  country_code: string;
  postcode: string;
  phone_number?: string;
  email?: string;
}

export interface LuluLineItem {
  external_id?: string;
  printable_normalization: {
    cover: { source_url: string };
    interior: { source_url: string };
    pod_package_id: string;
  };
  quantity: number;
  title?: string;
}

export interface LuluCreatePrintJobRequest {
  contact_email: string;
  line_items: LuluLineItem[];
  shipping_address: LuluShippingAddress;
  shipping_level: string;
  external_id?: string;
}

export interface LuluPrintJob {
  id: number;
  status: {
    name: string;
    message?: string;
  };
  line_items: Array<{
    id: number;
    status: { name: string };
    tracking_urls?: string[];
  }>;
  estimated_shipping_dates?: {
    arrival_min: string;
    arrival_max: string;
  };
  costs?: {
    line_item_costs: Array<{
      cost_excl_discounts: string;
      currency: string;
      quantity: number;
    }>;
    shipping_cost: { total_cost_excl_tax: string; currency: string };
    total_cost_excl_tax: string;
    total_tax: string;
    currency: string;
  };
}

/**
 * Lulu API Client
 */
export class LuluApiClient {
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;

  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly baseUrl: string;

  constructor() {
    const clientId = process.env.LULU_CLIENT_ID;
    const clientSecret = process.env.LULU_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error('LULU_CLIENT_ID and LULU_CLIENT_SECRET environment variables are required');
    }

    this.clientId = clientId;
    this.clientSecret = clientSecret;

    // Use sandbox for development, production for live orders
    const useSandbox = process.env.LULU_USE_SANDBOX === 'true';
    this.baseUrl = useSandbox ? LULU_CONFIG.SANDBOX_API : LULU_CONFIG.PRODUCTION_API;

    console.log(`[Lulu] Initialized client with base URL: ${this.baseUrl}`);
  }

  /**
   * Get a valid access token, refreshing if necessary.
   */
  async getAccessToken(): Promise<string> {
    // Return cached token if still valid (with 60 second buffer)
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60000) {
      return this.accessToken;
    }

    const tokenUrl = `${this.baseUrl}${LULU_CONFIG.TOKEN_ENDPOINT}`;

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to get Lulu access token: ${response.status} ${errorText}`);
    }

    const data = await response.json() as LuluToken;

    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + (data.expires_in * 1000);

    console.log(`[Lulu] Obtained access token (expires in ${data.expires_in}s)`);
    return this.accessToken;
  }

  /**
   * Make an authenticated request to the Lulu API.
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const token = await this.getAccessToken();

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Lulu] API error (${response.status}):`, errorText);
      // Try to parse as JSON for more detailed error info
      try {
        const errorJson = JSON.parse(errorText);
        console.error('[Lulu] API error details:', JSON.stringify(errorJson, null, 2));
      } catch {
        // HTML error response, already logged above
      }
      throw new Error(`Lulu API error: ${response.status} ${errorText}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Create a print job with Lulu.
   */
  async createPrintJob(params: {
    contactEmail: string;
    quantity: number;
    interiorPdfUrl: string;
    coverPdfUrl: string;
    shippingAddress: LuluShippingAddress;
    shippingLevel: string;
    bookTitle?: string;
    externalId?: string;
    podPackageId?: string;
  }): Promise<LuluPrintJob> {
    const requestBody: LuluCreatePrintJobRequest = {
      contact_email: params.contactEmail,
      external_id: params.externalId,
      line_items: [{
        printable_normalization: {
          cover: { source_url: params.coverPdfUrl },
          interior: { source_url: params.interiorPdfUrl },
          pod_package_id: params.podPackageId || LULU_CONFIG.DEFAULT_POD_PACKAGE,
        },
        quantity: params.quantity,
        title: params.bookTitle,
      }],
      shipping_address: {
        name: params.shippingAddress.name,
        street1: params.shippingAddress.street1,
        street2: params.shippingAddress.street2,
        city: params.shippingAddress.city,
        state_code: params.shippingAddress.state_code || '',
        country_code: params.shippingAddress.country_code,
        postcode: params.shippingAddress.postcode,
        phone_number: params.shippingAddress.phone_number || '+1 000 000 0000',
      },
      shipping_level: params.shippingLevel,
    };

    console.log('[Lulu] Creating print job:', JSON.stringify(requestBody, null, 2));

    return this.request<LuluPrintJob>(
      '/print-jobs/',
      {
        method: 'POST',
        body: JSON.stringify(requestBody),
      }
    );
  }

  /**
   * Get the status of an existing print job.
   */
  async getPrintJob(printJobId: number | string): Promise<LuluPrintJob> {
    return this.request<LuluPrintJob>(`/print-jobs/${printJobId}/`);
  }
}

// Export a singleton instance for convenience
let _client: LuluApiClient | null = null;

export function getLuluClient(): LuluApiClient {
  if (!_client) {
    _client = new LuluApiClient();
  }
  return _client;
}
