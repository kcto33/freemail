# Freemail CLI Read And Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add grouped `email`, `code`, and `doctor` commands to the existing Freemail CLI while keeping `read` and `wait` as compatibility aliases.

**Architecture:** Keep the Worker API unchanged for this slice and implement the new behavior in the CLI package. Reuse `/api/emails`, `/api/email/:id`, `/api/email/:id/download`, `/api/cli/session`, and `/api/domains`, then layer grouped parsing, filter-aware polling, code extraction, and diagnostics on top.

**Tech Stack:** Node.js, TypeScript, existing `packages/cli` command modules, Node test runner with `tsx`, Cloudflare Worker HTTP APIs

---

## File Structure

### Existing files to modify

- `packages/cli/src/index.ts`
  Add grouped `email`, `code`, and `doctor` commands plus compatibility alias routing.
- `packages/cli/src/api.ts`
  Expand the authenticated client with email-list, email-detail, raw-download, and doctor-facing helpers.
- `packages/cli/src/commands/read.ts`
  Delegate to the grouped `email read` implementation so old and new entry points stay aligned.
- `packages/cli/src/commands/wait.ts`
  Delegate to the grouped `email wait` implementation so the compatibility alias remains stable.
- `packages/cli/README.md`
  Document grouped commands and compatibility aliases.

### New files to create

- `packages/cli/src/commands/email.ts`
  Own grouped email list/latest/read/download/wait behavior.
- `packages/cli/src/commands/code.ts`
  Own verification-code extraction, `code latest`, and `code wait`.
- `packages/cli/src/commands/doctor.ts`
  Own configuration and connectivity diagnostics.
- `packages/cli/tests/code-commands.test.ts`
  Add code extraction and wait-path tests.
- `packages/cli/tests/doctor.test.ts`
  Add doctor success and failure-mode tests.

### Existing tests to extend

- `packages/cli/tests/mail-commands.test.ts`
  Extend to cover grouped routing, email list/latest, download, and filter-aware waits.

---

### Task 1: Add grouped command routing and compatibility aliases

**Files:**
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/src/commands/read.ts`
- Modify: `packages/cli/src/commands/wait.ts`
- Test: `packages/cli/tests/mail-commands.test.ts`

- [ ] **Step 1: Write a failing grouped-routing test**

```ts
test('top-level read remains a compatibility alias', async () => {
  const calls: number[] = [];

  await main(['read', '--id', '7'], {
    emailReadAction: async (options) => {
      calls.push(options.id);
    },
  });

  assert.deepEqual(calls, [7]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test packages/cli/tests/mail-commands.test.ts`
Expected: FAIL because `main` is not injectable/exported for grouped routing yet.

- [ ] **Step 3: Add grouped parsing to `index.ts`**

```ts
if (group === 'email' && command === 'list') {
  const mailbox = getOption(argv, 'mailbox');
  if (!mailbox) throw new Error('email list 需要提供 --mailbox');
  await deps.emailListAction({
    mailbox,
    limit: Number(getOption(argv, 'limit') ?? '20'),
    json: argv.includes('--json'),
  });
  return;
}

if (group === 'email' && command === 'read') {
  const idValue = getOption(argv, 'id');
  if (!idValue) throw new Error('email read 需要提供 --id');
  await deps.emailReadAction({
    id: Number(idValue),
    json: argv.includes('--json'),
  });
  return;
}
```

- [ ] **Step 4: Make the old commands delegate**

```ts
export async function readAction(options) {
  await emailReadAction(options);
}

export async function waitAction(options) {
  await emailWaitAction(options);
}
```

- [ ] **Step 5: Run the routing test again**

Run: `npx tsx --test packages/cli/tests/mail-commands.test.ts`
Expected: PASS for routing coverage.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/index.ts packages/cli/src/commands/read.ts packages/cli/src/commands/wait.ts packages/cli/tests/mail-commands.test.ts
git commit -m "feat: add grouped cli routing"
```

### Task 2: Implement `email list`, `email latest`, and grouped `email read`

**Files:**
- Modify: `packages/cli/src/api.ts`
- Create: `packages/cli/src/commands/email.ts`
- Test: `packages/cli/tests/mail-commands.test.ts`

- [ ] **Step 1: Write failing tests for grouped email reads**

```ts
test('getLatestEmail returns the first message from the mailbox list', async () => {
  const row = await getLatestEmail({
    listEmails: async () => ([
      { id: 8, subject: 'latest' },
      { id: 3, subject: 'older' },
    ]),
  }, {
    mailbox: 'box@example.com',
  });

  assert.equal(row?.id, 8);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test packages/cli/tests/mail-commands.test.ts`
Expected: FAIL because `packages/cli/src/commands/email.ts` and the new API methods do not exist.

- [ ] **Step 3: Expand the API client**

```ts
export interface FreemailClient {
  listMailboxes(): Promise<{ list: Array<Record<string, unknown>>; total: number }>;
  listEmails(mailbox: string, limit?: number): Promise<Array<Record<string, unknown>>>;
  getMessage(id: number): Promise<Record<string, unknown>>;
  downloadMessage(id: number): Promise<Response>;
}
```

- [ ] **Step 4: Implement grouped email primitives**

```ts
export async function listEmailsForMailbox(client, options) {
  return client.listEmails(options.mailbox, options.limit ?? 20);
}

export async function getLatestEmail(client, options) {
  const rows = await client.listEmails(options.mailbox, 1);
  return rows[0] ?? null;
}

export async function readMessage(client, id) {
  return client.getMessage(id);
}
```

- [ ] **Step 5: Run the mail-command tests again**

Run: `npx tsx --test packages/cli/tests/mail-commands.test.ts`
Expected: PASS for grouped list/latest/read tests.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/api.ts packages/cli/src/commands/email.ts packages/cli/tests/mail-commands.test.ts
git commit -m "feat: add grouped email read commands"
```

### Task 3: Implement `email download`

**Files:**
- Modify: `packages/cli/src/commands/email.ts`
- Test: `packages/cli/tests/mail-commands.test.ts`

- [ ] **Step 1: Write a failing download test**

```ts
test('downloadMessageToFile uses the response filename when no output path is given', async () => {
  const result = await downloadMessageToFile({
    downloadMessage: async () => new Response('raw-eml', {
      headers: {
        'Content-Disposition': 'attachment; filename=\"message-9.eml\"',
      },
    }),
  }, {
    id: 9,
    cwd: tempDir,
  });

  assert.match(result.filePath, /message-9\.eml$/);
});
```

- [ ] **Step 2: Run the download test to verify it fails**

Run: `npx tsx --test packages/cli/tests/mail-commands.test.ts`
Expected: FAIL because `downloadMessageToFile` does not exist.

- [ ] **Step 3: Implement raw download and save behavior**

```ts
function parseDownloadFilename(response: Response, fallbackId: number): string {
  const header = response.headers.get('Content-Disposition') || '';
  const match = header.match(/filename=\"?([^\";]+)\"?/i);
  return match?.[1] || `message-${fallbackId}.eml`;
}

export async function downloadMessageToFile(client, options) {
  const response = await client.downloadMessage(options.id);
  const filePath = options.output
    ? path.resolve(options.output)
    : path.join(options.cwd ?? process.cwd(), parseDownloadFilename(response, options.id));
  // existing-file guard + fs.writeFile here
}
```

- [ ] **Step 4: Run the download test again**

Run: `npx tsx --test packages/cli/tests/mail-commands.test.ts`
Expected: PASS for download coverage.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/email.ts packages/cli/tests/mail-commands.test.ts
git commit -m "feat: add cli email download command"
```

### Task 4: Extend `email wait` with `from`, `subject`, and `contains` filters

**Files:**
- Modify: `packages/cli/src/commands/email.ts`
- Test: `packages/cli/tests/mail-commands.test.ts`

- [ ] **Step 1: Write a failing wait-filter test**

```ts
test('waitForMessage filters by sender and subject using list payloads first', async () => {
  const row = await waitForMessage({
    listEmails: async () => ([
      { id: 2, sender: 'no-reply@github.com', subject: 'Verify your device' },
    ]),
    getMessage: async () => ({ id: 2, content: 'device code 123456' }),
  }, {
    mailbox: 'box@example.com',
    timeoutSeconds: 5,
    intervalSeconds: 0,
    from: 'github.com',
    subject: 'verify',
    sleep: async () => {},
  });

  assert.equal(row?.id, 2);
});
```

- [ ] **Step 2: Run the wait-filter test to verify it fails**

Run: `npx tsx --test packages/cli/tests/mail-commands.test.ts`
Expected: FAIL because grouped wait filtering is not implemented.

- [ ] **Step 3: Implement filter-aware polling**

```ts
function matchesListFilters(row, options) {
  if (options.from && !String(row.sender ?? '').toLowerCase().includes(String(options.from).toLowerCase())) {
    return false;
  }
  if (options.subject && !String(row.subject ?? '').toLowerCase().includes(String(options.subject).toLowerCase())) {
    return false;
  }
  return true;
}

function matchesContainsFilter(detail, contains) {
  if (!contains) return true;
  const haystack = `${String(detail.content ?? '')}\n${String(detail.html_content ?? '')}`.toLowerCase();
  return haystack.includes(String(contains).toLowerCase());
}
```

- [ ] **Step 4: Run the wait-filter test again**

Run: `npx tsx --test packages/cli/tests/mail-commands.test.ts`
Expected: PASS for filtered wait coverage.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/email.ts packages/cli/tests/mail-commands.test.ts
git commit -m "feat: add filtered email wait command"
```

### Task 5: Add `code latest` and `code wait`

**Files:**
- Create: `packages/cli/src/commands/code.ts`
- Test: `packages/cli/tests/code-commands.test.ts`

- [ ] **Step 1: Write a failing code-extraction test**

```ts
test('extractVerificationCode falls back to body parsing', async () => {
  assert.equal(extractVerificationCode({
    content: 'Your verification code is 654321.',
  }), '654321');
});
```

- [ ] **Step 2: Run the code tests to verify they fail**

Run: `npx tsx --test packages/cli/tests/code-commands.test.ts`
Expected: FAIL because `packages/cli/src/commands/code.ts` does not exist.

- [ ] **Step 3: Implement code extraction and grouped code commands**

```ts
export function extractVerificationCode(message: Record<string, unknown>): string | null {
  if (message.verification_code != null && String(message.verification_code).trim()) {
    return String(message.verification_code).trim();
  }
  const haystack = `${String(message.content ?? '')}\n${String(message.html_content ?? '')}`;
  const match = haystack.match(/\b(\d{4,8})\b/);
  return match?.[1] ?? null;
}
```

- [ ] **Step 4: Reuse grouped email helpers**

```ts
export async function getLatestCode(client, options) {
  const latest = await getLatestEmail(client, { mailbox: options.mailbox });
  if (!latest) return null;
  const detail = await client.getMessage(Number(latest.id));
  return {
    code: extractVerificationCode(detail),
    message: detail,
  };
}
```

- [ ] **Step 5: Run the code tests again**

Run: `npx tsx --test packages/cli/tests/code-commands.test.ts`
Expected: PASS with extraction and wait coverage.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/commands/code.ts packages/cli/tests/code-commands.test.ts packages/cli/src/index.ts
git commit -m "feat: add cli code commands"
```

### Task 6: Add `doctor`

**Files:**
- Create: `packages/cli/src/commands/doctor.ts`
- Test: `packages/cli/tests/doctor.test.ts`

- [ ] **Step 1: Write a failing doctor test**

```ts
test('runDoctor reports config, session, and domains checks', async () => {
  const report = await runDoctor({
    loadConfig: async () => ({
      baseUrl: 'https://example.com',
      accessToken: 'token',
      username: 'alice',
      role: 'user',
      expiresAt: '2099-01-01T00:00:00.000Z',
      mailboxAddress: null,
    }),
    fetchImpl: async (url: string) => {
      if (String(url).endsWith('/api/cli/session')) {
        return new Response(JSON.stringify({ authenticated: true }), { status: 200 });
      }
      return new Response(JSON.stringify(['example.com']), { status: 200 });
    },
  });

  assert.equal(report.config.ok, true);
  assert.equal(report.session.ok, true);
  assert.equal(report.domains.ok, true);
});
```

- [ ] **Step 2: Run the doctor test to verify it fails**

Run: `npx tsx --test packages/cli/tests/doctor.test.ts`
Expected: FAIL because `packages/cli/src/commands/doctor.ts` does not exist.

- [ ] **Step 3: Implement doctor**

```ts
export async function runDoctor(deps = {}) {
  const load = deps.loadConfig ?? loadConfig;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const report = {
    config: { ok: false, message: '' },
    session: { ok: false, message: '' },
    domains: { ok: false, message: '' },
  };
  // config load, /api/cli/session fetch, /api/domains fetch
  return report;
}
```

- [ ] **Step 4: Run the doctor test again**

Run: `npx tsx --test packages/cli/tests/doctor.test.ts`
Expected: PASS with success and config-failure coverage.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/doctor.ts packages/cli/tests/doctor.test.ts packages/cli/src/index.ts
git commit -m "feat: add cli doctor command"
```

### Task 7: Update docs and run full verification

**Files:**
- Modify: `packages/cli/README.md`

- [ ] **Step 1: Update the CLI README**

````md
Grouped email commands:

```bash
freemail email list --mailbox box@example.com --json
freemail email latest --mailbox box@example.com
freemail email read --id 42 --json
freemail email download --id 42 --output ./message.eml
freemail email wait --mailbox box@example.com --from github.com --subject Verify --contains code
```

Grouped code commands:

```bash
freemail code latest --mailbox box@example.com
freemail code wait --mailbox box@example.com --timeout 120
```

Diagnostics:

```bash
freemail doctor
freemail doctor --json
```
````

- [ ] **Step 2: Run the full CLI test suite**

Run: `npx tsx --test packages/cli/tests/mail-commands.test.ts packages/cli/tests/code-commands.test.ts packages/cli/tests/doctor.test.ts packages/cli/tests/auth.test.ts packages/cli/tests/create-command.test.ts`
Expected: PASS with grouped-command, auth, and create tests green.

- [ ] **Step 3: Build the CLI**

Run: `npm --prefix packages/cli run build`
Expected: PASS and emit `packages/cli/dist/index.js`.

- [ ] **Step 4: Manual verification**

Run:

```bash
node packages/cli/dist/index.js auth login --base-url https://your.freemail.domain
node packages/cli/dist/index.js email list --mailbox your-box@example.com --json
node packages/cli/dist/index.js email latest --mailbox your-box@example.com --json
node packages/cli/dist/index.js email download --id 1 --output .\\message-1.eml
node packages/cli/dist/index.js code latest --mailbox your-box@example.com
node packages/cli/dist/index.js code wait --mailbox your-box@example.com --timeout 30
node packages/cli/dist/index.js email wait --mailbox your-box@example.com --from github.com --subject Verify --contains code --json
node packages/cli/dist/index.js doctor --json
```

Expected:

- grouped commands work with the existing stored CLI token
- download writes an `.eml` file locally
- code commands print or return extracted codes
- filtered wait returns only matching messages
- doctor reports valid config/session/domain checks

- [ ] **Step 5: Commit**

```bash
git add packages/cli/README.md packages/cli/src packages/cli/tests
git commit -m "feat: add grouped cli read and automation commands"
```
