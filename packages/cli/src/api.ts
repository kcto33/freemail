import { loadConfig } from './config.js';

export interface CliSessionResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_at: string;
  username: string;
  role: string;
  mailbox_address: string | null;
}

export async function requestJson<T>(
  url: string,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const response = await fetchImpl(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export interface FreemailClient {
  listMailboxes(): Promise<{ list: Array<Record<string, unknown>>; total: number }>;
  listEmails(mailbox: string, limit?: number): Promise<Array<Record<string, unknown>>>;
  getMessage(id: number): Promise<Record<string, unknown>>;
  downloadMessage(id: number): Promise<Response>;
}

export interface CreateClientOptions {
  configDir?: string;
  fetchImpl?: typeof fetch;
}

export function createClient(options: CreateClientOptions = {}): FreemailClient {
  const fetchImpl = options.fetchImpl ?? fetch;

  async function authedJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    const config = await loadConfig({ configDir: options.configDir });
    return requestJson<T>(new URL(path, config.baseUrl).toString(), {
      ...init,
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        ...(init.headers ?? {}),
      },
    }, fetchImpl);
  }

  async function authedResponse(path: string, init: RequestInit = {}): Promise<Response> {
    const config = await loadConfig({ configDir: options.configDir });
    const response = await fetchImpl(new URL(path, config.baseUrl).toString(), {
      ...init,
      headers: {
        Accept: '*/*',
        Authorization: `Bearer ${config.accessToken}`,
        ...(init.headers ?? {}),
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `HTTP ${response.status}`);
    }

    return response;
  }

  return {
    listMailboxes() {
      return authedJson<{ list: Array<Record<string, unknown>>; total: number }>('/api/mailboxes');
    },
    listEmails(mailbox: string, limit = 20) {
      const query = new URLSearchParams({
        mailbox,
        limit: String(limit),
      });

      return authedJson<Array<Record<string, unknown>>>(`/api/emails?${query.toString()}`);
    },
    getMessage(id: number) {
      return authedJson<Record<string, unknown>>(`/api/email/${id}`);
    },
    downloadMessage(id: number) {
      return authedResponse(`/api/email/${id}/download`);
    },
  };
}
