# Freemail CLI Read And Automation Design

Date: 2026-04-17
Project: `freemail`
Scope: grouped CLI read-path and automation commands

## Summary

This design extends the existing `freemail` CLI from a small V1 command set into a more practical daily-use tool for reading mail and scripting verification flows.

The selected scope is:

- `freemail email list --mailbox ...`
- `freemail email latest --mailbox ...`
- `freemail email download --id ...`
- `freemail email wait --mailbox ... [--from] [--subject] [--contains]`
- `freemail code latest --mailbox ...`
- `freemail code wait --mailbox ... --timeout ...`
- `freemail doctor`

This phase also formalizes grouped command names while preserving compatibility with the current top-level CLI.

## Goals

- Make the CLI useful for actual inbox workflows, not just mailbox creation and raw message reads.
- Add grouped command names that can grow cleanly over time.
- Support automation-friendly verification-code retrieval.
- Reuse the existing Worker API surface where possible.
- Keep the implementation narrow enough to ship without redesigning the server.

## Non-Goals

- Full `mailbox` or `admin` command families.
- Publishing the CLI to npm in this slice.
- Replacing the current auth flow.
- Adding a new server-side search/query API.
- Adding attachment parsing, MIME inspection, or mailbox sending features.

## Current State

The current CLI already supports:

- `auth login`
- `auth status`
- `auth logout`
- `create`
- `list` (mailbox list)
- `read`
- `wait`

The current Worker already exposes the main API surface needed for message reads:

- `GET /api/emails?mailbox=...`
- `GET /api/email/:id`
- `GET /api/email/:id/download`
- `GET /api/domains`
- `GET /api/cli/session`

The main gap is not raw capability. The gap is CLI ergonomics and read-oriented automation behavior.

## Recommended Approach

Use grouped subcommands for new behavior while retaining compatibility aliases for the existing top-level commands.

Canonical grouped commands introduced in this slice:

- `freemail email list`
- `freemail email latest`
- `freemail email read`
- `freemail email wait`
- `freemail email download`
- `freemail code latest`
- `freemail code wait`
- `freemail doctor`

Compatibility behavior in this slice:

- existing `freemail read` remains as an alias to `freemail email read`
- existing `freemail wait` remains as an alias to `freemail email wait`
- existing `freemail list` remains mailbox-list behavior and is not renamed yet

This keeps the CLI stable for current usage while allowing the new read-path to expand without collapsing into ambiguous top-level commands.

## Command Model

### `freemail email list --mailbox <address>`

Purpose:

- list recent messages for one mailbox

Behavior:

- call `GET /api/emails?mailbox=...&limit=...`
- return messages in descending received-time order
- default to a short human-readable table
- support `--json`

Recommended options:

- `--mailbox <address>` required
- `--limit <n>` optional, default `20`, capped client-side at `50`
- `--json`

Human-readable fields:

- `id`
- `received_at`
- `sender`
- `subject`
- `verification_code` when present

### `freemail email latest --mailbox <address>`

Purpose:

- return the newest message without requiring the user to manually inspect IDs

Behavior:

- internally call the same mailbox list path with `limit=1`
- if no message exists, return a clean not-found style result
- support `--json`

This command is intentionally thin. It is a convenience wrapper, not a new server-side feature.

### `freemail email read --id <message_id>`

Purpose:

- grouped canonical version of the current `read`

Behavior:

- reuse the existing message detail implementation
- preserve current default output and `--json`

Compatibility:

- top-level `freemail read` remains supported as an alias in this phase

### `freemail email download --id <message_id>`

Purpose:

- fetch and save the raw `.eml` source for one message

Behavior:

- call `GET /api/email/:id/download`
- default output path is the current working directory
- if the response provides a filename in `Content-Disposition`, use it
- otherwise fall back to `message-<id>.eml`

Recommended options:

- `--id <message_id>` required
- `--output <path>` optional override
- `--force` optional overwrite flag

Human-readable output:

- print the saved file path

### `freemail email wait --mailbox <address>`

Purpose:

- wait for the first new message matching optional filters

Behavior:

1. fetch the current mailbox message list and remember baseline IDs
2. poll the same mailbox until timeout
3. identify unseen messages
4. apply lightweight filters from list payload first
5. if `--contains` is present, fetch message detail for candidates and match against text/HTML content
6. return the first matching message

Recommended options:

- `--mailbox <address>` required
- `--timeout <seconds>` default `120`
- `--interval <seconds>` default `3`
- `--from <text>` optional sender substring match
- `--subject <text>` optional subject substring match
- `--contains <text>` optional body substring match
- `--json`

Matching rules:

- `--from` is case-insensitive substring match against `sender`
- `--subject` is case-insensitive substring match against `subject`
- `--contains` is case-insensitive substring match against message text first, then HTML fallback

Timeout behavior:

- must not throw as an error
- default human output should say timeout
- `--json` should return `{ "timeout": true, ... }`

### `freemail code latest --mailbox <address>`

Purpose:

- return only the verification code from the newest relevant message

Behavior:

- fetch the newest message for the mailbox
- if `verification_code` is present in the API payload, use it directly
- if not present, fall back to extracting a likely code from the body text

Fallback extraction scope:

- 4-8 digit numeric codes
- first strong match wins

If no code is found:

- return a clear error in human mode
- return `{ "code": null, ... }` or a non-zero exit depending on final CLI conventions

This slice should prefer deterministic behavior:

- machine-readable output should include message metadata and extracted code
- default human output should print just the code when found

### `freemail code wait --mailbox <address>`

Purpose:

- block until a new matching message arrives and a code can be extracted

Behavior:

- reuse `email wait`
- after a matching message is found, extract the code using the same logic as `code latest`

Recommended options:

- all `email wait` options
- `--mailbox <address>` required
- `--timeout <seconds>`
- `--interval <seconds>`
- optional `--from`
- optional `--subject`
- optional `--contains`
- `--json`

Default human output:

- print only the code

This makes it useful in shell automation:

```bash
CODE=$(freemail code wait --mailbox test@example.com --timeout 120)
```

### `freemail doctor`

Purpose:

- give the user a fast way to diagnose local CLI configuration and Worker reachability

Behavior:

1. check whether local CLI config exists
2. show configured `base_url`
3. call `GET /api/cli/session` with the stored token
4. call `GET /api/domains`
5. summarize success/failure for each check

Recommended checks:

- config file exists
- token exists
- base URL reachable
- CLI session valid
- domain list fetch works

Output:

- human-readable status lines by default
- structured object in `--json`

This is intentionally a read-only health check, not a repair command.

## API Reuse Strategy

This design deliberately avoids new Worker endpoints for the first cut.

Command-to-API mapping:

- `email list` -> `GET /api/emails`
- `email latest` -> `GET /api/emails` with `limit=1`
- `email read` -> `GET /api/email/:id`
- `email download` -> `GET /api/email/:id/download`
- `email wait` -> repeated `GET /api/emails`, plus `GET /api/email/:id` when `--contains` is used
- `code latest` -> `GET /api/emails` + `GET /api/email/:id` as needed
- `code wait` -> same as `email wait`, plus code extraction
- `doctor` -> `GET /api/cli/session` and `GET /api/domains`

This keeps the slice small and reduces deployment risk.

## Internal CLI Structure

The CLI should add new command modules rather than overloading the current ones:

```text
packages/cli/src/
  commands/
    auth.ts
    create.ts
    list.ts
    read.ts
    wait.ts
    email.ts
    code.ts
    doctor.ts
```

Responsibilities:

- `email.ts` owns grouped email list/latest/read/download/wait logic
- `code.ts` owns verification-code extraction and code-specific wrappers
- `doctor.ts` owns configuration and connectivity diagnostics
- `read.ts` and `wait.ts` become thin compatibility shims or delegate to grouped implementations

This avoids scattering message-list and filter logic across multiple old files.

## Error Handling

This slice should normalize these cases:

- missing mailbox argument
- missing message ID
- no config file
- expired or revoked token
- empty mailbox
- wait timeout
- download destination already exists without `--force`
- code not found in latest or waited-for message

Rules:

- human mode should be concise and explicit
- `--json` should return machine-usable output for timeout and no-message cases
- permission-denied and auth failures should preserve non-zero exits

## Security Notes

- `doctor` must not print the raw access token
- `download` must not silently overwrite files unless `--force` is set
- grouped commands must keep using the existing bearer-token auth path
- new code-extraction helpers must not bypass existing Worker-side ownership checks

## Testing Strategy

### CLI tests

Add focused tests for:

- `email list` result formatting and JSON path
- `email latest` empty and non-empty mailbox behavior
- `email download` path selection and overwrite handling
- `email wait` sender/subject/body filtering
- `code latest` direct verification-code path
- `code latest` fallback extraction path
- `code wait` timeout and success behavior
- `doctor` success and partial-failure summaries
- compatibility aliases for top-level `read` and `wait`

### Manual verification

At minimum verify:

1. `freemail email list --mailbox ...`
2. `freemail email latest --mailbox ...`
3. `freemail email download --id ...`
4. `freemail code latest --mailbox ...`
5. `freemail code wait --mailbox ...`
6. `freemail email wait --mailbox ... --from ...`
7. `freemail doctor`

## Implementation Sequence

Recommended order:

1. add grouped command parsing and compatibility routing
2. implement `email list` and `email latest`
3. implement `email download`
4. extend `email wait` with filters
5. add code extraction helpers plus `code latest`
6. add `code wait`
7. add `doctor`
8. update CLI docs

This sequence delivers useful commands early while keeping later tasks layered on top of already-tested primitives.

## Deferred Work

The following are intentionally deferred:

- `mailbox` grouped commands
- admin-only CLI management commands
- richer body search on the Worker
- attachment export
- streaming message downloads to stdout
- automatic repair actions in `doctor`
- publishing the CLI to npm

## Design Decisions Locked In

- grouped subcommands are now the canonical forward path
- old `read` and `wait` remain compatibility aliases in this slice
- `email wait` filtering is client-side, not a new server endpoint
- `code` commands reuse message APIs and extraction helpers
- `doctor` is read-only and safe to run on any machine
