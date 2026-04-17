import { requestJson } from '../api.js';
import { loadConfig } from '../config.js';
import { printJson, printLine } from '../output.js';

export interface CreateMailboxResult {
  email: string;
  expires: number;
}

export interface CreateMailboxOptions {
  length?: number;
  domainIndex?: number;
}

export interface CreateMailboxClient {
  createRandomMailbox(length?: number, domainIndex?: number): Promise<CreateMailboxResult>;
}

export interface WorkerClientOptions {
  configDir?: string;
  fetchImpl?: typeof fetch;
}

async function createWorkerClient(options: WorkerClientOptions = {}): Promise<CreateMailboxClient> {
  const config = await loadConfig({ configDir: options.configDir });
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    createRandomMailbox(length?: number, domainIndex?: number) {
      const query = new URLSearchParams();

      if (length !== undefined) {
        query.set('length', String(length));
      }

      if (domainIndex !== undefined) {
        query.set('domainIndex', String(domainIndex));
      }

      const suffix = query.toString();
      const url = new URL(`/api/generate${suffix ? `?${suffix}` : ''}`, config.baseUrl).toString();

      return requestJson<CreateMailboxResult>(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
        },
      }, fetchImpl);
    },
  };
}

export async function createMailbox(
  client: CreateMailboxClient | undefined = undefined,
  options: CreateMailboxOptions = {},
  workerOptions: WorkerClientOptions = {},
): Promise<CreateMailboxResult> {
  const resolvedClient = client ?? await createWorkerClient(workerOptions);
  return resolvedClient.createRandomMailbox(options.length, options.domainIndex);
}

export async function createAction(options: {
  length?: number;
  domainIndex?: number;
  json?: boolean;
  client?: CreateMailboxClient;
  configDir?: string;
  fetchImpl?: typeof fetch;
} = {}): Promise<void> {
  const mailbox = await createMailbox(options.client, {
    length: options.length,
    domainIndex: options.domainIndex,
  }, {
    configDir: options.configDir,
    fetchImpl: options.fetchImpl,
  });

  if (options.json) {
    printJson(mailbox);
    return;
  }

  printLine(`Email: ${mailbox.email}`);
  printLine(`Expires: ${new Date(mailbox.expires).toISOString()}`);
}
