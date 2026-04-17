import { createClient, type FreemailClient } from '../api.js';
import { printJson, printLine } from '../output.js';

export async function listMailboxes(
  client: Pick<FreemailClient, 'listMailboxes'> = createClient(),
): Promise<Array<Record<string, unknown>>> {
  const response = await client.listMailboxes();
  return response.list ?? [];
}

export async function listAction(options: {
  client?: Pick<FreemailClient, 'listMailboxes'>;
  json?: boolean;
} = {}): Promise<void> {
  const rows = await listMailboxes(options.client ?? createClient());

  if (options.json) {
    printJson(rows);
    return;
  }

  for (const row of rows) {
    const address = typeof row.address === 'string' ? row.address : String(row.address ?? '');
    printLine(address);
  }
}
