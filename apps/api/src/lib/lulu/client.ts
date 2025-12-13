/**
 * Lulu Print-on-Demand API Client
 *
 * Handles OAuth 2.0 authentication and API calls to Lulu's print service.
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
  page_count: number;
  pod_package_id: string;
  quantity: number;
  interior: {
    source_url: string;
  };
  cover: {
    source_url: string;
  };
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

export interface LuluPrintJobCostRequest {
  line_items: Array<{
    page_count: number;
    pod_package_id: string;
    quantity: number;
  }>;
  shipping_address: LuluShippingAddress;
  shipping_option: string;
}

export interface LuluPrintJobCostResponse {
  total_cost_excl_tax: string;
  total_tax: string;
  total_cost_incl_tax: string;
  currency: string;
  line_item_costs: Array<{
    cost_excl_discounts: string;
    quantity: number;
    currency: string;
  }>;
  shipping_cost: {
    total_cost_excl_tax: string;
    currency: string;
  };
}

// Lulu /shipping-options/ returns an array directly, not wrapped in an object
export interface LuluShippingOption {
  level: string;
  total_cost_excl_tax: string;
  total_cost_incl_tax: string;
  currency: string;
  estimated_shipping_dates: {
    arrival_min: string;
    arrival_max: string;
  };
}

export type LuluShippingOptionsResponse = LuluShippingOption[];

/**
 * Lulu API Client
 *
 * Usage:
 * ```
 * const client = new LuluApiClient();
 * const cost = await client.calculateCost({ ... });
 * const job = await client.createPrintJob({ ... });
 * ```
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
      throw new Error(`Lulu API error: ${response.status} ${errorText}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Calculate the cost of a print job before creating it.
   */
  async calculateCost(params: {
    pageCount: number;
    quantity: number;
    shippingAddress: LuluShippingAddress;
    shippingOption: string;
    podPackageId?: string;
  }): Promise<LuluPrintJobCostResponse> {
    const requestBody = {
      line_items: [{
        page_count: params.pageCount,
        pod_package_id: params.podPackageId || LULU_CONFIG.DEFAULT_POD_PACKAGE,
        quantity: params.quantity,
      }],
      // /print-job-cost-calculations/ uses country_code (unlike /shipping-options/ which uses country)
      shipping_address: {
        city: params.shippingAddress.city,
        country_code: params.shippingAddress.country_code,
        postcode: params.shippingAddress.postcode,
        state_code: params.shippingAddress.state_code,
        street1: params.shippingAddress.street1,
        phone_number: params.shippingAddress.phone_number || '+1 000 000 0000',
      },
      shipping_option: params.shippingOption,
    };

    return this.request<LuluPrintJobCostResponse>(
      '/print-job-cost-calculations/',
      {
        method: 'POST',
        body: JSON.stringify(requestBody),
      }
    );
  }

  /**
   * Get available shipping options for a given address.
   *
   * Official Lulu API Endpoint: POST /shipping-options/
   * Docs: https://api.lulu.com/docs/#tag/Shipping-Options
   */
  async getShippingOptions(params: {
    pageCount: number;
    quantity: number;
    shippingAddress: LuluShippingAddress;
    podPackageId?: string;
  }): Promise<LuluShippingOptionsResponse> {
    const requestBody = {
      line_items: [{
        page_count: params.pageCount,
        pod_package_id: params.podPackageId || LULU_CONFIG.DEFAULT_POD_PACKAGE,
        quantity: params.quantity,
      }],
      // Lulu API uses "country" not "country_code" in shipping_address
      shipping_address: {
        city: params.shippingAddress.city,
        country: params.shippingAddress.country_code,
        postcode: params.shippingAddress.postcode,
        state_code: params.shippingAddress.state_code,
        street1: params.shippingAddress.street1,
        phone_number: params.shippingAddress.phone_number || '+1 000 000 0000',
      },
    };

    return this.request<LuluShippingOptionsResponse>(
      '/shipping-options/',
      {
        method: 'POST',
        body: JSON.stringify(requestBody),
      }
    );
  }

  /**
   * Create a print job with Lulu.
   */
  async createPrintJob(params: {
    contactEmail: string;
    pageCount: number;
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
      line_items: [{
        page_count: params.pageCount,
        pod_package_id: params.podPackageId || LULU_CONFIG.DEFAULT_POD_PACKAGE,
        quantity: params.quantity,
        interior: {
          source_url: params.interiorPdfUrl,
        },
        cover: {
          source_url: params.coverPdfUrl,
        },
        title: params.bookTitle,
      }],
      shipping_address: params.shippingAddress,
      shipping_level: params.shippingLevel,
      external_id: params.externalId,
    };

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

  /**
   * Cancel a print job (only possible if not yet in production).
   */
  async cancelPrintJob(printJobId: number | string): Promise<void> {
    await this.request(`/print-jobs/${printJobId}/`, {
      method: 'DELETE',
    });
  }

  /**
   * Validate that a PDF meets Lulu's specifications.
   * Note: This is a simple dimension check, not a full validation.
   */
  static validateInteriorSpecs(pageCount: number): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (pageCount < LULU_CONFIG.SADDLE_STITCH.MIN_PAGES) {
      errors.push(`Page count ${pageCount} is below minimum of ${LULU_CONFIG.SADDLE_STITCH.MIN_PAGES}`);
    }

    if (pageCount > LULU_CONFIG.SADDLE_STITCH.MAX_PAGES) {
      errors.push(`Page count ${pageCount} exceeds maximum of ${LULU_CONFIG.SADDLE_STITCH.MAX_PAGES}`);
    }

    // Saddle stitch requires page count divisible by 4
    if (pageCount % 4 !== 0) {
      errors.push(`Saddle stitch binding requires page count divisible by 4 (got ${pageCount})`);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
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
