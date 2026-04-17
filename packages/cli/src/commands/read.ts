import { createClient, type FreemailClient } from '../api.js';
import { printJson, printLine } from '../output.js';

export async function readMessage(
  client: Pick<FreemailClient, 'getMessage'> = createClient(),
  id: number,
): Promise<Record<string, unknown>> {
  return client.getMessage(id);
}

function formatBody(message: Record<string, unknown>): string {
  const content = message.content ?? message.html_content ?? message.text ?? '';
  return typeof content === 'string' ? content : String(content);
}

export async function readAction(options: {
  id: number;
  client?: Pick<FreemailClient, 'getMessage'>;
  json?: boolean;
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
