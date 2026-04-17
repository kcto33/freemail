#!/usr/bin/env node
import { loginAction, logoutAction, statusAction } from './commands/auth.js';
import { createAction } from './commands/create.js';
import { listAction } from './commands/list.js';
import { readAction } from './commands/read.js';
import { waitAction } from './commands/wait.js';
import { printError } from './output.js';

function getOption(argv: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const match = argv.find((value) => value.startsWith(prefix));
  if (match) {
    return match.slice(prefix.length);
  }

  const index = argv.indexOf(`--${name}`);
  if (index === -1) {
    return undefined;
  }

  return argv[index + 1];
}

async function main(argv = process.argv.slice(2)): Promise<void> {
  const [group, command] = argv;

  if (group === 'create') {
    const lengthValue = getOption(argv, 'length');
    const domainIndexValue = getOption(argv, 'domain-index');

    await createAction({
      length: lengthValue === undefined ? undefined : Number(lengthValue),
      domainIndex: domainIndexValue === undefined ? undefined : Number(domainIndexValue),
      json: argv.includes('--json'),
    });
    return;
  }

  if (group === 'list') {
    await listAction({
      json: argv.includes('--json'),
    });
    return;
  }

  if (group === 'read') {
    const idValue = getOption(argv, 'id') ?? argv[1];
    if (!idValue) {
      throw new Error('读取邮件需要提供 --id');
    }

    await readAction({
      id: Number(idValue),
      json: argv.includes('--json'),
    });
    return;
  }

  if (group === 'wait') {
    const mailbox = getOption(argv, 'mailbox') ?? argv[1];
    if (!mailbox) {
      throw new Error('等待邮件需要提供 --mailbox');
    }

    const timeoutSeconds = Number(getOption(argv, 'timeout') ?? '120');
    const intervalSeconds = Number(getOption(argv, 'interval') ?? '3');

    await waitAction({
      mailbox,
      timeoutSeconds,
      intervalSeconds,
      json: argv.includes('--json'),
    });
    return;
  }

  if (group !== 'auth') {
    throw new Error('用法: freemail <auth|create|list|read|wait>');
  }

  if (command === 'login') {
    const baseUrl = getOption(argv, 'base-url') ?? process.env.FREEMAIL_BASE_URL;
    if (!baseUrl) {
      throw new Error('登录需要提供 --base-url');
    }

    await loginAction({ baseUrl });
    return;
  }

  if (command === 'status') {
    await statusAction({
      json: argv.includes('--json'),
    });
    return;
  }

  if (command === 'logout') {
    await logoutAction();
    return;
  }

  throw new Error('用法: freemail auth <login|status|logout>');
}

await main().catch((error: unknown) => {
  printError(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
