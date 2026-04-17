import { createClient, type FreemailClient } from '../api.js';
import { printJson, printLine } from '../output.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asMessageId(row: Record<string, unknown>): string {
  return String(row.id ?? '');
}

export async function waitForMessage(
  client: Pick<FreemailClient, 'listEmails'> = createClient(),
  mailbox: string,
  options: {
    timeoutSeconds: number;
    intervalSeconds: number;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<Record<string, unknown> | null> {
  const wait = options.sleep ?? sleep;
  const baseline = await client.listEmails(mailbox, 20);
  const seen = new Set(baseline.map(asMessageId));
  const deadline = Date.now() + options.timeoutSeconds * 1000;

  while (Date.now() < deadline) {
    await wait(options.intervalSeconds * 1000);
    const rows = await client.listEmails(mailbox, 20);
    const fresh = rows.find((row) => !seen.has(asMessageId(row)));
    if (fresh) {
      return fresh;
    }

    for (const row of rows) {
      seen.add(asMessageId(row));
    }
  }

  return null;
}

export async function waitAction(options: {
  mailbox: string;
  timeoutSeconds: number;
  intervalSeconds: number;
  client?: Pick<FreemailClient, 'listEmails'>;
  json?: boolean;
}): Promise<void> {
  const message = await waitForMessage(options.client ?? createClient(), options.mailbox, {
    timeoutSeconds: options.timeoutSeconds,
    intervalSeconds: options.intervalSeconds,
  });

  if (!message) {
    if (options.json) {
      printJson({ timeout: true, mailbox: options.mailbox });
      return;
    }

    printLine(`No new message arrived for ${options.mailbox} before timeout`);
    return;
  }

  if (options.json) {
    printJson(message);
    return;
  }

  const subject = typeof message.subject === 'string' ? message.subject : String(message.subject ?? '');
  printLine(`${String(message.id ?? '')} ${subject}`.trim());
}
