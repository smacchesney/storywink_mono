import { ApiResponse } from '@storywink/shared';

interface RequestOptions extends RequestInit {
  token?: string;
}

class ApiClient {
  private async request<T>(
    endpoint: string,
    options: RequestOptions = {}
  ): Promise<ApiResponse<T>> {
    const { token, ...fetchOptions } = options;

    const config: RequestInit = {
      ...fetchOptions,
      headers: {
        ...fetchOptions.headers,
      },
    };

    // Only set Content-Type if not already set and body is not FormData
    if (!(config.headers as any)?.['Content-Type'] && !(fetchOptions.body instanceof FormData)) {
      config.headers = {
        'Content-Type': 'application/json',
        ...config.headers,
      };
    }

    // Add authorization header if token is provided
    if (token) {
      config.headers = {
        ...config.headers,
        Authorization: `Bearer ${token}`,
      };
    }

    try {
      const response = await fetch(endpoint, config);
      const data = await response.json();

      if (!response.ok) {
        console.error('API response error:', { endpoint, status: response.status, data });
        // Same shape the catch below produces, but keeps the server's
        // machine-readable `code` so callers can localize coded errors.
        return {
          success: false,
          error: data.error || 'API request failed',
          ...(typeof data.code === 'string' ? { code: data.code } : {}),
        };
      }

      return data;
    } catch (error) {
      console.error('API request error:', { endpoint, error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // Books
  async getBooks(token: string) {
    return this.request('/api/books', { token });
  }

  async createBook(data: any, token: string) {
    return this.request('/api/book/create', {
      method: 'POST',
      body: JSON.stringify(data),
      token,
    });
  }

  async deleteBook(bookId: string, token: string) {
    return this.request(`/api/book/${bookId}`, {
      method: 'DELETE',
      token,
    });
  }
}

// Export singleton instance
export const apiClient = new ApiClient();

// Export class for testing or custom instances
export { ApiClient };
