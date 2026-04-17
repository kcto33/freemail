#!/usr/bin/env node
import { loginAction, logoutAction, statusAction } from './commands/auth.js';
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

  if (group !== 'auth') {
    throw new Error('用法: freemail auth <login|status|logout>');
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
