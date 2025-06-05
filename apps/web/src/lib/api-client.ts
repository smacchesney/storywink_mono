import { ApiResponse } from '../shared';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

interface RequestOptions extends RequestInit {
  token?: string;
}

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_URL) {
    this.baseUrl = baseUrl;
  }

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
      const response = await fetch(`${this.baseUrl}${endpoint}`, config);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'API request failed');
      }

      return data;
    } catch (error) {
      console.error('API request error:', error);
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

  async getBook(bookId: string, token: string) {
    return this.request(`/api/books/${bookId}`, { token });
  }

  async createBook(data: any, token: string) {
    return this.request('/api/book/create', {
      method: 'POST',
      body: JSON.stringify(data),
      token,
    });
  }

  async updateBook(bookId: string, data: any, token: string) {
    return this.request(`/api/books/${bookId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
      token,
    });
  }

  async deleteBook(bookId: string, token: string) {
    return this.request(`/api/books/${bookId}`, {
      method: 'DELETE',
      token,
    });
  }

  // Pages
  async updatePage(bookId: string, pageId: string, data: any, token: string) {
    return this.request(`/api/pages/${bookId}/${pageId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
      token,
    });
  }

  // Generation
  async generateStory(bookId: string, token: string) {
    return this.request('/api/generate/story', {
      method: 'POST',
      body: JSON.stringify({ bookId }),
      token,
    });
  }

  async generateIllustrations(bookId: string, pageIds: string[], token: string) {
    return this.request('/api/generate/illustrations', {
      method: 'POST',
      body: JSON.stringify({ bookId, pageIds }),
      token,
    });
  }

  // Upload
  async uploadFile(file: File, token: string) {
    const formData = new FormData();
    formData.append('files', file);

    return this.request('/api/upload', {
      method: 'POST',
      body: formData,
      headers: {}, // Let browser set content-type for FormData
      token,
    });
  }

  // Health check
  async health() {
    return this.request('/api/health');
  }
}

// Export singleton instance
export const apiClient = new ApiClient();

// Export class for testing or custom instances
export { ApiClient };