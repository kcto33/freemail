import { type FreemailClient } from '../api.js';
import { emailWaitAction, waitForMessage as groupedWaitForMessage } from './email.js';

export async function waitForMessage(
  client: Pick<FreemailClient, 'listEmails' | 'getMessage'>,
  mailbox: string,
  options: {
    timeoutSeconds: number;
    intervalSeconds: number;
    from?: string;
    subject?: string;
    contains?: string;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<Record<string, unknown> | null> {
  return groupedWaitForMessage(client, {
    mailbox,
    timeoutSeconds: options.timeoutSeconds,
    intervalSeconds: options.intervalSeconds,
    from: options.from,
    subject: options.subject,
    contains: options.contains,
    sleep: options.sleep,
  });
}

export async function waitAction(options: {
  mailbox: string;
  timeoutSeconds: number;
  intervalSeconds: number;
  from?: string;
  subject?: string;
  contains?: string;
  client?: Pick<FreemailClient, 'listEmails' | 'getMessage'>;
  json?: boolean;
}): Promise<void> {
  await emailWaitAction(options);
}
