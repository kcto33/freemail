#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { loginAction, logoutAction, statusAction } from './commands/auth.js';
import { codeLatestAction, codeWaitAction } from './commands/code.js';
import { createAction } from './commands/create.js';
import { doctorAction } from './commands/doctor.js';
import { emailDownloadAction, emailLatestAction, emailListAction, emailReadAction, emailWaitAction } from './commands/email.js';
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

export interface MainDeps {
  codeLatestAction?: (options: { mailbox: string; json?: boolean }) => Promise<void>;
  codeWaitAction?: (options: { mailbox: string; timeoutSeconds: number; intervalSeconds: number; from?: string; subject?: string; contains?: string; json?: boolean }) => Promise<void>;
  doctorAction?: (options: { json?: boolean }) => Promise<void>;
  emailListAction?: (options: { mailbox: string; limit?: number; json?: boolean }) => Promise<void>;
  emailLatestAction?: (options: { mailbox: string; json?: boolean }) => Promise<void>;
  emailReadAction?: (options: { id: number; json?: boolean }) => Promise<void>;
  emailDownloadAction?: (options: { id: number; output?: string; force?: boolean }) => Promise<void>;
  emailWaitAction?: (options: { mailbox: string; timeoutSeconds: number; intervalSeconds: number; from?: string; subject?: string; contains?: string; json?: boolean }) => Promise<void>;
}

export async function main(argv = process.argv.slice(2), deps: MainDeps = {}): Promise<void> {
  const [group, command] = argv;
  const runCodeLatest = deps.codeLatestAction ?? codeLatestAction;
  const runCodeWait = deps.codeWaitAction ?? codeWaitAction;
  const runDoctor = deps.doctorAction ?? doctorAction;
  const runEmailList = deps.emailListAction ?? emailListAction;
  const runEmailLatest = deps.emailLatestAction ?? emailLatestAction;
  const runEmailRead = deps.emailReadAction ?? readAction;
  const runEmailDownload = deps.emailDownloadAction ?? emailDownloadAction;
  const runEmailWait = deps.emailWaitAction ?? emailWaitAction;

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

  if (group === 'email' && command === 'read') {
    const idValue = getOption(argv, 'id');
    if (!idValue) {
      throw new Error('email read 需要提供 --id');
    }

    await runEmailRead({
      id: Number(idValue),
      json: argv.includes('--json'),
    });
    return;
  }

  if (group === 'email' && command === 'list') {
    const mailbox = getOption(argv, 'mailbox');
    if (!mailbox) {
      throw new Error('email list 需要提供 --mailbox');
    }

    await runEmailList({
      mailbox,
      limit: Number(getOption(argv, 'limit') ?? '20'),
      json: argv.includes('--json'),
    });
    return;
  }

  if (group === 'email' && command === 'latest') {
    const mailbox = getOption(argv, 'mailbox');
    if (!mailbox) {
      throw new Error('email latest 需要提供 --mailbox');
    }

    await runEmailLatest({
      mailbox,
      json: argv.includes('--json'),
    });
    return;
  }

  if (group === 'email' && command === 'download') {
    const idValue = getOption(argv, 'id');
    if (!idValue) {
      throw new Error('email download 需要提供 --id');
    }

    await runEmailDownload({
      id: Number(idValue),
      output: getOption(argv, 'output'),
      force: argv.includes('--force'),
    });
    return;
  }

  if (group === 'email' && command === 'wait') {
    const mailbox = getOption(argv, 'mailbox');
    if (!mailbox) {
      throw new Error('email wait 需要提供 --mailbox');
    }

    await runEmailWait({
      mailbox,
      timeoutSeconds: Number(getOption(argv, 'timeout') ?? '120'),
      intervalSeconds: Number(getOption(argv, 'interval') ?? '3'),
      from: getOption(argv, 'from'),
      subject: getOption(argv, 'subject'),
      contains: getOption(argv, 'contains'),
      json: argv.includes('--json'),
    });
    return;
  }

  if (group === 'code' && command === 'latest') {
    const mailbox = getOption(argv, 'mailbox');
    if (!mailbox) {
      throw new Error('code latest 需要提供 --mailbox');
    }

    await runCodeLatest({
      mailbox,
      json: argv.includes('--json'),
    });
    return;
  }

  if (group === 'code' && command === 'wait') {
    const mailbox = getOption(argv, 'mailbox');
    if (!mailbox) {
      throw new Error('code wait 需要提供 --mailbox');
    }

    await runCodeWait({
      mailbox,
      timeoutSeconds: Number(getOption(argv, 'timeout') ?? '120'),
      intervalSeconds: Number(getOption(argv, 'interval') ?? '3'),
      from: getOption(argv, 'from'),
      subject: getOption(argv, 'subject'),
      contains: getOption(argv, 'contains'),
      json: argv.includes('--json'),
    });
    return;
  }

  if (group === 'doctor') {
    await runDoctor({
      json: argv.includes('--json'),
    });
    return;
  }

  if (group === 'read') {
    const idValue = getOption(argv, 'id') ?? argv[1];
    if (!idValue) {
      throw new Error('读取邮件需要提供 --id');
    }

    await runEmailRead({
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

    await runEmailWait({
      mailbox,
      timeoutSeconds,
      intervalSeconds,
      from: getOption(argv, 'from'),
      subject: getOption(argv, 'subject'),
      contains: getOption(argv, 'contains'),
      json: argv.includes('--json'),
    });
    return;
  }

  if (group !== 'auth') {
    throw new Error('用法: freemail <auth|create|list|read|wait|email|code|doctor>');
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

const entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entryHref) {
  await main().catch((error: unknown) => {
    printError(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
