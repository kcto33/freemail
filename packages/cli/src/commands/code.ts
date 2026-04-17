import { createClient, type FreemailClient } from '../api.js';
import { printJson, printLine } from '../output.js';
import { getLatestEmail, waitForMessage } from './email.js';

export function extractVerificationCode(message: Record<string, unknown>): string | null {
  if (message.verification_code != null && String(message.verification_code).trim()) {
    return String(message.verification_code).trim();
  }

  const haystack = `${String(message.content ?? '')}\n${String(message.html_content ?? '')}`;
  const match = haystack.match(/\b(\d{4,8})\b/);
  return match?.[1] ?? null;
}

export async function getLatestCode(
  client: Pick<FreemailClient, 'listEmails' | 'getMessage'> = createClient(),
  options: { mailbox: string },
): Promise<{ code: string | null; message: Record<string, unknown> } | null> {
  const latest = await getLatestEmail(client, { mailbox: options.mailbox });
  if (!latest) return null;

  const detail = await client.getMessage(Number(latest.id));
  return {
    code: extractVerificationCode(detail),
    message: detail,
  };
}

export async function waitForCode(
  client: Pick<FreemailClient, 'listEmails' | 'getMessage'> = createClient(),
  options: {
    mailbox: string;
    timeoutSeconds: number;
    intervalSeconds: number;
    from?: string;
    subject?: string;
    contains?: string;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<{ code: string | null; message: Record<string, unknown> } | null> {
  const message = await waitForMessage(client, options);
  if (!message) return null;

  const detail = message.content != null || message.html_content != null
    ? message
    : await client.getMessage(Number(message.id));

  return {
    code: extractVerificationCode(detail),
    message: detail,
  };
}

export async function codeLatestAction(options: {
  mailbox: string;
  json?: boolean;
  client?: Pick<FreemailClient, 'listEmails' | 'getMessage'>;
}): Promise<void> {
  const result = await getLatestCode(options.client ?? createClient(), options);
  if (!result) {
    throw new Error('该邮箱暂无邮件');
  }

  if (options.json) {
    printJson(result);
    return;
  }

  if (!result.code) {
    throw new Error('最新邮件中未提取到验证码');
  }

  printLine(result.code);
}

export async function codeWaitAction(options: {
  mailbox: string;
  timeoutSeconds: number;
  intervalSeconds: number;
  from?: string;
  subject?: string;
  contains?: string;
  json?: boolean;
  client?: Pick<FreemailClient, 'listEmails' | 'getMessage'>;
}): Promise<void> {
  const result = await waitForCode(options.client ?? createClient(), options);
  if (!result) {
    if (options.json) {
      printJson({ timeout: true, mailbox: options.mailbox });
      return;
    }

    printLine(`No matching code arrived for ${options.mailbox} before timeout`);
    return;
  }

  if (options.json) {
    printJson(result);
    return;
  }

  if (!result.code) {
    throw new Error('匹配邮件中未提取到验证码');
  }

  printLine(result.code);
}
