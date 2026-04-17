# Freemail CLI

Agent-friendly CLI for Freemail. It supports browser-assisted login, mailbox creation, grouped email read commands, verification-code helpers, and local diagnostics.

## Install

```bash
npm install --prefix packages/cli
npm --prefix packages/cli run build
```

## Authentication

```bash
node packages/cli/dist/index.js auth login --base-url https://your.freemail.domain
node packages/cli/dist/index.js auth status
node packages/cli/dist/index.js auth logout
```

## Mailbox Commands

```bash
node packages/cli/dist/index.js create --json
node packages/cli/dist/index.js create --length 12 --domain-index 1
node packages/cli/dist/index.js list --json
```

## Grouped Email Commands

```bash
node packages/cli/dist/index.js email list --mailbox box@example.com --json
node packages/cli/dist/index.js email latest --mailbox box@example.com
node packages/cli/dist/index.js email read --id 42 --json
node packages/cli/dist/index.js email download --id 42 --output ./message-42.eml
node packages/cli/dist/index.js email wait --mailbox box@example.com --from github.com --subject Verify --contains code --json
```

## Code Commands

```bash
node packages/cli/dist/index.js code latest --mailbox box@example.com
node packages/cli/dist/index.js code wait --mailbox box@example.com --timeout 120
```

## Diagnostics

```bash
node packages/cli/dist/index.js doctor
node packages/cli/dist/index.js doctor --json
```

## Compatibility Aliases

```bash
node packages/cli/dist/index.js read --id 42
node packages/cli/dist/index.js wait --mailbox box@example.com
```

## Notes

- `create` uses the authenticated Worker session.
- `--json` prints machine-readable output for agents and scripts.
- `email wait` first filters by sender/subject from the list payload, then fetches message detail if `--contains` is used.
- `code` commands prefer the Worker-provided `verification_code` and fall back to extracting a 4-8 digit code from the body.
