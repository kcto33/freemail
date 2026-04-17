import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { requestJson, type CliSessionResponse } from '../api.js';
import { openUrl } from '../browser.js';
import { clearConfig, loadConfig, saveConfig, type CliConfig } from '../config.js';
import { printJson, printLine } from '../output.js';

export interface AuthExchangeInput {
  baseUrl: string;
  state: string;
  code: string;
  fetchImpl?: typeof fetch;
}

export interface AuthSessionStatus {
  authenticated: boolean;
  username: string;
  role: string;
  expires_at?: string;
  mailbox_address?: string | null;
}

export async function exchangeAuthCode({
  baseUrl,
  state,
  code,
  fetchImpl = fetch,
}: AuthExchangeInput): Promise<CliConfig> {
  const body = await requestJson<CliSessionResponse>(
    `${baseUrl}/api/cli/auth/exchange`,
    {
      method: 'POST',
      body: JSON.stringify({ state, code }),
    },
    fetchImpl,
  );

  return {
    baseUrl,
    accessToken: body.access_token,
    username: body.username,
    role: body.role,
    expiresAt: body.expires_at,
    mailboxAddress: body.mailbox_address,
  };
}

export async function getSessionStatus({
  baseUrl,
  accessToken,
  fetchImpl = fetch,
}: {
  baseUrl: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
}): Promise<AuthSessionStatus> {
  return requestJson<AuthSessionStatus>(
    `${baseUrl}/api/cli/session`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    fetchImpl,
  );
}

export async function loginAction(options: {
  baseUrl: string;
  configDir?: string;
  fetchImpl?: typeof fetch;
  openBrowser?: (url: string) => Promise<void>;
}): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const openBrowser = options.openBrowser ?? openUrl;

  const start = await requestJson<{ state: string; auth_url: string }>(
    `${options.baseUrl}/api/cli/auth/start`,
    {
      method: 'POST',
      body: JSON.stringify({}),
    },
    fetchImpl,
  );

  await openBrowser(start.auth_url);
  printLine(`已打开浏览器：${start.auth_url}`);

  const rl = createInterface({ input, output });
  const code = (await rl.question('请输入网页显示的一次性授权码: ')).trim().toUpperCase();
  rl.close();

  const session = await exchangeAuthCode({
    baseUrl: options.baseUrl,
    state: start.state,
    code,
    fetchImpl,
  });

  await saveConfig(session, { configDir: options.configDir });
  printLine(`登录成功：${session.username} (${session.role})`);
}

export async function statusAction(options: {
  configDir?: string;
  fetchImpl?: typeof fetch;
  json?: boolean;
} = {}): Promise<void> {
  const config = await loadConfig({ configDir: options.configDir });
  const remote = await getSessionStatus({
    baseUrl: config.baseUrl,
    accessToken: config.accessToken,
    fetchImpl: options.fetchImpl,
  });

  if (options.json) {
    printJson({
      ...config,
      authenticated: remote.authenticated,
      mailboxAddress: remote.mailbox_address ?? config.mailboxAddress ?? null,
    });
    return;
  }

  printLine(`当前用户: ${remote.username}`);
  printLine(`角色: ${remote.role}`);
  printLine(`过期时间: ${remote.expires_at ?? config.expiresAt}`);
}

export async function logoutAction(options: {
  configDir?: string;
  fetchImpl?: typeof fetch;
} = {}): Promise<void> {
  const config = await loadConfig({ configDir: options.configDir });
  const fetchImpl = options.fetchImpl ?? fetch;

  await fetchImpl(`${config.baseUrl}/api/cli/logout`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
    },
  });

  await clearConfig({ configDir: options.configDir });
  printLine('已退出 CLI 登录态');
}
