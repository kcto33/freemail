# Freemail CLI V1 Design

Date: 2026-04-16
Project: `freemail`
Scope: Native CLI package and its supporting server-side authentication flow

## Summary

This design adds an agent-friendly native CLI to `freemail`, modeled after the `moemail` CLI shape but adapted to `freemail`'s current Worker architecture and authentication model.

The first version will support:

- `auth login`
- `auth logout`
- `auth status`
- `create`
- `list`
- `wait`
- `read`

The CLI must support both administrator accounts and ordinary mailbox users without requiring the CLI to store the service-wide `JWT_TOKEN`.

## Goals

- Add a distributable CLI package inside the same repository.
- Support safe CLI authentication without persisting the root admin override token.
- Reuse existing `freemail` API behavior where possible.
- Provide human-readable output by default and `--json` output for automation.
- Keep the first release narrow enough to implement and verify quickly.

## Non-Goals

- Frontend visual redesign. That remains a separate sub-project.
- Automatic localhost callback login flow.
- Full command parity with `moemail`.
- Replacing the existing browser login or cookie-based session flow.
- Adding a general-purpose API key platform for third-party apps in V1.

## Current Constraints

`freemail` is currently a Cloudflare Worker application with:

- static frontend assets under `public/`
- backend routing in `src/routes` and `src/api`
- authentication centered around cookie/JWT browser sessions
- a `JWT_TOKEN` environment variable that also acts as a root admin override

That root admin override is too sensitive to use as the default CLI credential. CLI V1 must avoid persisting it locally.

## Recommended Approach

Create a new monorepo-style package at `packages/cli` and add a dedicated CLI authentication flow based on:

1. browser login
2. a short-lived one-time authorization code
3. exchange of that code for a CLI-specific access token

This keeps the CLI package close to the main codebase, minimizes deployment friction, and avoids coupling the CLI to the root admin token.

## Repository Layout

The new work is split into two bounded areas:

- Worker/server updates inside the existing `src/` tree
- a new independent package at `packages/cli`

Planned package layout:

```text
packages/cli/
  package.json
  README.md
  tsconfig.json
  src/
    index.ts
    api.ts
    config.ts
    output.ts
    commands/
      auth.ts
      create.ts
      list.ts
      read.ts
      wait.ts
```

This mirrors the `moemail` CLI layout closely enough to keep future expansion straightforward.

## Authentication Design

### Why not use `JWT_TOKEN`

`freemail`'s `JWT_TOKEN` is not just a signing secret. It also acts as a root admin override. Any CLI design that stores it on disk would effectively store a permanent service-wide super-admin credential locally.

CLI V1 will not persist `JWT_TOKEN`, will not ask users to configure it, and will not depend on it for normal CLI usage.

### Login Flow

CLI V1 uses a browser-assisted authorization flow with a manual code handoff:

1. User runs `freemail auth login`.
2. CLI asks for or reads a configured `base_url`.
3. CLI opens the browser to a CLI authorization page on the `freemail` site.
4. User logs in using the existing site login mechanism.
5. After successful login, the site shows a one-time authorization code.
6. User pastes that code back into the CLI.
7. CLI exchanges the code for a CLI-specific access token.
8. CLI stores the returned CLI token locally and uses it for future API calls.

This supports:

- strict administrators
- normal administrators
- ordinary users
- mailbox users

It does not require local callback ports, browser bridge logic, or service-wide secrets.

### CLI Token Model

The CLI access token is separate from browser cookies and separate from `JWT_TOKEN`.

Properties:

- opaque random token, not a self-describing JWT
- only the hashed token is stored server-side
- scoped to one authenticated principal
- revocable
- expiring
- usable through standard `Authorization: Bearer <token>` headers

Default token lifetime for V1: 30 days.

### One-Time Authorization Code

The browser-visible code used during login has these properties:

- short lifetime, default 5 minutes
- single-use only
- stored server-side as a hash
- invalid immediately after successful exchange

This keeps the manual copy/paste flow simple without turning the code itself into a reusable credential.

## Role Behavior

CLI commands are uniform, but final authorization continues to come from the server.

### `strictAdmin` / `admin`

- can create mailboxes
- can list visible mailboxes
- can wait for and read accessible email

### `user`

- can create and list mailboxes according to current server-side rules
- can wait for and read email only for accessible mailboxes

### `mailbox`

- cannot create new mailboxes in V1
- `list` returns only the mailbox account's own mailbox
- `wait` and `read` work only on that mailbox

The CLI must not hardcode privilege escalation. It should surface the server response clearly when a role lacks permission.

## Server-Side Changes

### New Data Tables

Add two D1 tables:

#### `cli_auth_codes`

Stores temporary authorization codes.

Recommended fields:

- `id`
- `code_hash`
- `user_id`
- `role`
- `username`
- `mailbox_id`
- `mailbox_address`
- `created_at`
- `expires_at`
- `used_at`

#### `cli_tokens`

Stores active CLI sessions.

Recommended fields:

- `id`
- `token_hash`
- `user_id`
- `role`
- `username`
- `mailbox_id`
- `mailbox_address`
- `created_at`
- `expires_at`
- `last_used_at`
- `revoked_at`

Only hashes are stored for codes and tokens.

### New Endpoints

Add a dedicated CLI auth surface:

- `POST /api/cli/auth/start`
- `POST /api/cli/auth/issue-code`
- `POST /api/cli/auth/exchange`
- `GET /api/cli/session`
- `POST /api/cli/logout`

#### `POST /api/cli/auth/start`

Purpose:

- create a pending authorization session
- return the browser URL to open

Expected output:

- `auth_url`
- `state`
- expiration metadata if useful

#### `POST /api/cli/auth/issue-code`

Purpose:

- after browser login, issue a one-time code for the authenticated principal

Requirements:

- must require an already authenticated browser session
- must bind the generated code to the pending CLI auth session

#### `POST /api/cli/auth/exchange`

Purpose:

- exchange the one-time code for a CLI token

Expected output:

- `access_token`
- `token_type`
- `expires_at`
- `username`
- `role`
- mailbox identity when applicable

#### `GET /api/cli/session`

Purpose:

- validate current CLI token
- support `auth status`

Expected output:

- `authenticated`
- `username`
- `role`
- `expires_at`

#### `POST /api/cli/logout`

Purpose:

- revoke the presented CLI token

### Middleware Changes

Extend authentication middleware so requests can authenticate in this order:

1. CLI bearer token
2. existing root admin override behavior
3. existing browser cookie/JWT session

If a valid CLI token is present, middleware should construct an `authPayload` compatible with existing route authorization checks. This keeps API handlers reusable.

## CLI Command Design

### `freemail auth login`

Behavior:

- reads or prompts for `base_url`
- starts auth flow with the server
- opens the browser
- prompts for one-time code
- exchanges code for CLI token
- saves CLI config locally

Local config must store:

- `base_url`
- `access_token`
- `username`
- `role`
- `expires_at`

It must not store:

- `JWT_TOKEN`
- login passwords
- browser cookies

### `freemail auth status`

Behavior:

- calls `GET /api/cli/session`
- reports current authenticated principal and expiry

### `freemail auth logout`

Behavior:

- revokes remote token through `POST /api/cli/logout`
- removes local token from config

### `freemail create`

V1 behavior:

- create a random mailbox through existing server behavior
- initially map to `GET /api/generate`

Future expansion can add custom local part creation via `POST /api/create`.

### `freemail list`

Behavior:

- list visible mailboxes
- map to `GET /api/mailboxes`

Mailbox users will simply receive their own mailbox only.

### `freemail wait`

Behavior:

- poll `GET /api/emails?mailbox=...`
- detect the first unseen message
- return success when a new message arrives
- return a timeout result if no new message arrives before the configured deadline

V1 options:

- `--mailbox <address>`
- `--timeout <seconds>`
- `--interval <seconds>`
- `--json`

Default polling interval: 3 seconds.
Default timeout: 120 seconds.

### `freemail read`

Behavior:

- fetch one message by ID
- map to `GET /api/email/:id`

V1 options:

- `--id <message_id>`
- `--json`

Human-readable output should show sender, subject, received time, verification code, and text content when available.

## API Reuse Strategy

CLI V1 should reuse the existing mailbox and message APIs as much as possible:

- `create` -> existing create/generate API
- `list` -> existing mailbox list API
- `wait` -> existing email list API
- `read` -> existing email detail API

Only the CLI auth endpoints are new in V1.

This keeps the implementation narrow and reduces the risk of changing mailbox behavior for the web app.

## Output Contract

All CLI commands should support two output modes:

- human-readable default output
- structured `--json` output

Conventions:

- success data goes to stdout
- errors go to stderr
- exit code `0` for success
- exit code `1` for runtime or server error
- exit code `2` for configuration or authentication error

## Security Notes

- Do not persist `JWT_TOKEN` in CLI config.
- Do not reuse browser cookies as CLI credentials.
- Store only hashed auth codes and hashed CLI tokens in D1.
- Expire auth codes quickly and invalidate on first use.
- Allow CLI tokens to be revoked independently.
- Treat mailbox users as first-class CLI principals with restricted scope, not as special cases that fall back to admin behavior.

## Error Handling

V1 must explicitly handle:

- missing login
- expired or revoked CLI token
- permission denied
- mailbox not visible to the authenticated principal
- `wait` timeout without treating it as a crash

For mailbox visibility and permission errors, responses should avoid leaking unrelated mailbox existence.

## Testing Strategy

### Server Tests

Cover:

- issuing auth codes after browser-authenticated login
- exchanging valid auth codes
- rejecting expired or reused auth codes
- validating CLI tokens
- revoking CLI tokens
- role propagation for admin, user, and mailbox principals

### CLI Tests

Cover:

- login success flow
- login failure flow
- `auth status`
- `auth logout`
- `list`
- `create`
- `wait` success path
- `wait` timeout path
- `read`

### Manual Verification

At minimum, manually verify:

1. admin login from browser to CLI
2. mailbox-user login from browser to CLI
3. create/list/wait/read against a live local or remote deployment

## Implementation Sequence

Recommended order:

1. add D1 schema for CLI auth codes and CLI tokens
2. add CLI auth endpoints
3. extend auth middleware for CLI bearer tokens
4. scaffold `packages/cli`
5. implement `auth login`, `auth status`, `auth logout`
6. implement `list`
7. implement `read`
8. implement `wait`
9. implement `create`

This ordering prioritizes authentication first, then the smallest useful read path, then mailbox creation.

## Deferred Work

The following are intentionally deferred beyond CLI V1:

- automatic localhost callback login
- `delete`
- `send`
- `skill install`
- publish/install workflow polish
- frontend redesign beyond the minimal CLI authorization page
- dedicated low-privilege API key system for third-party integrations

## Open Decisions Already Resolved

The following decisions were made during design review:

- CLI V1 is a separate sub-project from frontend redesign.
- CLI V1 is modeled after `moemail` but kept smaller initially.
- CLI V1 supports both administrators and mailbox users.
- CLI V1 does not store `JWT_TOKEN`.
- CLI V1 uses browser login plus manual one-time code exchange.
- Initial command scope is `auth login`, `auth logout`, `auth status`, `create`, `list`, `wait`, and `read`.
