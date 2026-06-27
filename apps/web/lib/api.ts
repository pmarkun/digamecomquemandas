const API_BASE = process.env.API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000/api/v1';

export const api = {
  async get<T>(path: string, headers: Record<string, string> = {}): Promise<T> {
    const response = await fetch(`${API_BASE}${path}`, {
      headers: {
        ...headers,
      },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Erro na API: ${response.status} ${text}`);
    }
    return (await response.json()) as T;
  },

  async post<T>(
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ): Promise<T> {
    const response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Erro na API: ${response.status} ${text}`);
    }
    return (await response.json()) as T;
  },
};
