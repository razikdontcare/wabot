/**
 * Fetch client utility to replace axios with native fetch API
 * Provides similar interface to axios for easy migration
 */

export interface FetchClientConfig {
    baseURL?: string;
    timeout?: number;
    headers?: Record<string, string>;
    validateStatus?: (status: number) => boolean;
}

export interface FetchRequestConfig extends FetchClientConfig {
    method?: string;
    params?: Record<string, string | number | boolean>;
    responseType?: 'json' | 'arraybuffer' | 'blob' | 'text';
    maxRedirects?: number;
    signal?: AbortSignal;
}

export interface FetchResponse<T = any> {
    data: T;
    status: number;
    statusText: string;
    headers: Headers;
}

export class FetchError extends Error {
    code?: string;
    response?: {
        status: number;
        statusText: string;
        data?: any;
    };

    constructor(message: string, code?: string, response?: { status: number; statusText: string; data?: any }) {
        super(message);
        this.name = 'FetchError';
        this.code = code;
        this.response = response;
    }
}

export class FetchClient {
    private config: FetchClientConfig;

    constructor(config: FetchClientConfig = {}) {
        this.config = config;
    }

    async request<T = any>(url: string, config: FetchRequestConfig = {}): Promise<FetchResponse<T>> {
        const {
            method = 'GET',
            params,
            headers = {},
            timeout,
            responseType = 'json',
            validateStatus = (status) => status >= 200 && status < 300,
            signal,
        } = config;

        const fullURL = this.buildURL(url, params);
        const mergedHeaders = {...this.config.headers, ...headers};

        let body: any;
        if (config.method && ['POST', 'PUT', 'PATCH'].includes(config.method.toUpperCase())) {
            if ((config as any).data) {
                body = typeof (config as any).data === 'string'
                    ? (config as any).data
                    : JSON.stringify((config as any).data);
                if (!mergedHeaders['Content-Type'] && typeof (config as any).data === 'object') {
                    mergedHeaders['Content-Type'] = 'application/json';
                }
            }
        }

        try {
            const response = await this.fetchWithTimeout(
                fullURL,
                {
                    method,
                    headers: mergedHeaders,
                    body,
                    signal,
                },
                timeout
            );

            // Handle validation
            if (!validateStatus(response.status)) {
                let errorData: any;
                try {
                    const contentType = response.headers.get('content-type');
                    if (contentType && contentType.includes('application/json')) {
                        errorData = await response.json();
                    } else {
                        errorData = await response.text();
                    }
                } catch {
                    errorData = 'Failed to parse error response';
                }

                throw new FetchError(
                    `Request failed with status ${response.status}`,
                    undefined,
                    {
                        status: response.status,
                        statusText: response.statusText,
                        data: errorData,
                    }
                );
            }

            let data: any;
            if (responseType === 'arraybuffer') {
                data = await response.arrayBuffer();
            } else if (responseType === 'blob') {
                data = await response.blob();
            } else if (responseType === 'text') {
                data = await response.text();
            } else {
                // json
                try {
                    data = await response.json();
                } catch {
                    data = await response.text();
                }
            }

            return {
                data,
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
            };
        } catch (error: any) {
            // Handle network errors
            if (error instanceof FetchError) {
                throw error;
            }

            if (error.name === 'TypeError' && error.message.includes('fetch')) {
                throw new FetchError('Network error', 'ENOTFOUND');
            }

            throw new FetchError(error.message || 'Request failed', error.code);
        }
    }

    async get<T = any>(url: string, config: FetchRequestConfig = {}): Promise<FetchResponse<T>> {
        return this.request<T>(url, {...config, method: 'GET'});
    }

    async post<T = any>(url: string, data?: any, config: FetchRequestConfig = {}): Promise<FetchResponse<T>> {
        return this.request<T>(url, {...config, method: 'POST', data} as any);
    }

    async put<T = any>(url: string, data?: any, config: FetchRequestConfig = {}): Promise<FetchResponse<T>> {
        return this.request<T>(url, {...config, method: 'PUT', data} as any);
    }

    async delete<T = any>(url: string, config: FetchRequestConfig = {}): Promise<FetchResponse<T>> {
        return this.request<T>(url, {...config, method: 'DELETE'});
    }

    async patch<T = any>(url: string, data?: any, config: FetchRequestConfig = {}): Promise<FetchResponse<T>> {
        return this.request<T>(url, {...config, method: 'PATCH', data} as any);
    }

    private buildURL(url: string, params?: Record<string, string | number | boolean>): string {
        const baseURL = this.config.baseURL || '';
        const fullURL = url.startsWith('http') ? url : `${baseURL}${url}`;

        if (!params || Object.keys(params).length === 0) {
            return fullURL;
        }

        const urlObj = new URL(fullURL);
        Object.entries(params).forEach(([key, value]) => {
            urlObj.searchParams.append(key, String(value));
        });
        return urlObj.toString();
    }

    private async fetchWithTimeout(
        url: string,
        options: RequestInit,
        timeout?: number
    ): Promise<Response> {
        const timeoutMs = timeout || this.config.timeout;

        if (!timeoutMs) {
            return fetch(url, options);
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetch(url, {
                ...options,
                signal: options.signal || controller.signal,
            });
            clearTimeout(timeoutId);
            return response;
        } catch (error: any) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new FetchError('Request timeout', 'ECONNABORTED');
            }
            throw error;
        }
    }
}

// Helper function to check if error is a FetchError
export function isFetchError(error: any): error is FetchError {
    return error instanceof FetchError;
}

// Create a default instance
export function createFetchClient(config: FetchClientConfig = {}): FetchClient {
    return new FetchClient(config);
}

