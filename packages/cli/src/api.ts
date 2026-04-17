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
