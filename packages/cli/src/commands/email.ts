import fs from 'node:fs/promises';
import path from 'node:path';
import { createClient, type FreemailClient } from '../api.js';
import { printJson, printLine } from '../output.js';

export async function listEmailsForMailbox(
  client: Pick<FreemailClient, 'listEmails'> = createClient(),
  options: { mailbox: string; limit?: number },
): Promise<Array<Record<string, unknown>>> {
  return client.listEmails(options.mailbox, options.limit ?? 20);
}

export async function getLatestEmail(
  client: Pick<FreemailClient, 'listEmails'> = createClient(),
  options: { mailbox: string },
): Promise<Record<string, unknown> | null> {
  const rows = await client.listEmails(options.mailbox, 1);
  return rows[0] ?? null;
}

export async function readMessage(
  client: Pick<FreemailClient, 'getMessage'> = createClient(),
  id: number,
): Promise<Record<string, unknown>> {
  return client.getMessage(id);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(value: unknown): string {
  return String(value ?? '').toLowerCase();
}

function matchesListFilters(
  row: Record<string, unknown>,
  options: { from?: string; subject?: string },
): boolean {
  if (options.from && !normalizeText(row.sender).includes(normalizeText(options.from))) {
    return false;
  }

  if (options.subject && !normalizeText(row.subject).includes(normalizeText(options.subject))) {
    return false;
  }

  return true;
}

function matchesContainsFilter(
  detail: Record<string, unknown>,
  contains?: string,
): boolean {
  if (!contains) return true;
  const haystack = `${String(detail.content ?? '')}\n${String(detail.html_content ?? '')}`.toLowerCase();
  return haystack.includes(String(contains).toLowerCase());
}

function parseDownloadFilename(response: Response, fallbackId: number): string {
  const header = response.headers.get('Content-Disposition') || '';
  const match = header.match(/filename=\"?([^\";]+)\"?/i);
  return match?.[1] || `message-${fallbackId}.eml`;
}

export async function downloadMessageToFile(
  client: Pick<FreemailClient, 'downloadMessage'> = createClient(),
  options: {
    id: number;
    output?: string;
    force?: boolean;
    cwd?: string;
  },
): Promise<{ filePath: string }> {
  const response = await client.downloadMessage(options.id);
  const cwd = options.cwd ?? process.cwd();
  const filePath = options.output
    ? path.resolve(options.output)
    : path.join(cwd, parseDownloadFilename(response, options.id));

  try {
    const stat = await fs.stat(filePath);
    if (stat && !options.force) {
      throw new Error(`文件已存在: ${filePath}`);
    }
  } catch (error) {
    if (error instanceof Error && !('code' in error)) {
      throw error;
    }
    const code = (error as NodeJS.ErrnoException).code;
    if (code && code !== 'ENOENT') {
      throw error;
    }
  }

  const content = await response.text();
  await fs.writeFile(filePath, content, 'utf8');
  return { filePath };
}

function formatBody(message: Record<string, unknown>): string {
  const content = message.content ?? message.html_content ?? message.text ?? '';
  return typeof content === 'string' ? content : String(content);
}

export async function emailListAction(options: {
  mailbox: string;
  limit?: number;
  json?: boolean;
  client?: Pick<FreemailClient, 'listEmails'>;
}): Promise<void> {
  const rows = await listEmailsForMailbox(options.client ?? createClient(), {
    mailbox: options.mailbox,
    limit: options.limit,
  });

  if (options.json) {
    printJson(rows);
    return;
  }

  for (const row of rows) {
    const id = String(row.id ?? '');
    const receivedAt = String(row.received_at ?? '');
    const sender = String(row.sender ?? '');
    const subject = String(row.subject ?? '');
    printLine(`${id}\t${receivedAt}\t${sender}\t${subject}`);
  }
}

export async function emailLatestAction(options: {
  mailbox: string;
  json?: boolean;
  client?: Pick<FreemailClient, 'listEmails'>;
}): Promise<void> {
  const row = await getLatestEmail(options.client ?? createClient(), {
    mailbox: options.mailbox,
  });

  if (!row) {
    throw new Error('该邮箱暂无邮件');
  }

  if (options.json) {
    printJson(row);
    return;
  }

  printLine(`${String(row.id ?? '')} ${String(row.subject ?? '')}`.trim());
}

export async function emailReadAction(options: {
  id: number;
  json?: boolean;
  client?: Pick<FreemailClient, 'getMessage'>;
}): Promise<void> {
  const message = await readMessage(options.client ?? createClient(), options.id);

  if (options.json) {
    printJson(message);
    return;
  }

  const sender = typeof message.sender === 'string' ? message.sender : String(message.sender ?? '');
  const subject = typeof message.subject === 'string' ? message.subject : String(message.subject ?? '');
  const verificationCode = message.verification_code == null ? '' : String(message.verification_code);

  printLine(`From: ${sender}`);
  printLine(`Subject: ${subject}`);
  printLine(`Verification Code: ${verificationCode}`);
  printLine('');
  printLine(formatBody(message));
}

export async function waitForMessage(
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
): Promise<Record<string, unknown> | null> {
  const wait = options.sleep ?? sleep;
  const baseline = await client.listEmails(options.mailbox, 20);
  const seen = new Set(baseline.map((row) => String(row.id ?? '')));
  const deadline = Date.now() + options.timeoutSeconds * 1000;

  while (Date.now() < deadline) {
    await wait(options.intervalSeconds * 1000);
    const rows = await client.listEmails(options.mailbox, 20);

    for (const row of rows) {
      const id = String(row.id ?? '');
      if (seen.has(id)) continue;
      seen.add(id);

      if (!matchesListFilters(row, options)) {
        continue;
      }

      if (!options.contains) {
        return row;
      }

      const detail = await client.getMessage(Number(row.id));
      if (matchesContainsFilter(detail, options.contains)) {
        return detail;
      }
    }
  }

  return null;
}

export async function emailWaitAction(options: {
  mailbox: string;
  timeoutSeconds: number;
  intervalSeconds: number;
  from?: string;
  subject?: string;
  contains?: string;
  json?: boolean;
  client?: Pick<FreemailClient, 'listEmails' | 'getMessage'>;
}): Promise<void> {
  const message = await waitForMessage(options.client ?? createClient(), options);

  if (!message) {
    if (options.json) {
      printJson({ timeout: true, mailbox: options.mailbox });
      return;
    }

    printLine(`No matching message arrived for ${options.mailbox} before timeout`);
    return;
  }

  if (options.json) {
    printJson(message);
    return;
  }

  const subject = typeof message.subject === 'string' ? message.subject : String(message.subject ?? '');
  printLine(`${String(message.id ?? '')} ${subject}`.trim());
}

export async function emailDownloadAction(options: {
  id: number;
  output?: string;
  force?: boolean;
  client?: Pick<FreemailClient, 'downloadMessage'>;
}): Promise<void> {
  const result = await downloadMessageToFile(options.client ?? createClient(), options);
  printLine(result.filePath);
}
