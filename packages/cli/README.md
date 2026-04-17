# Freemail CLI

Agent-friendly CLI for Freemail. It supports browser-assisted login, mailbox listing, waiting for new mail, reading messages, and creating random mailboxes.

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

## Mailbox commands

```bash
node packages/cli/dist/index.js create --json
node packages/cli/dist/index.js create --length 12 --domain-index 1
node packages/cli/dist/index.js list --json
node packages/cli/dist/index.js wait --mailbox box@example.com --timeout 120 --json
node packages/cli/dist/index.js read --id 42 --json
```

## Notes

- `create` uses the authenticated Worker session.
- `--json` prints machine-readable output for agents and scripts.
- `wait` polls until it sees the first fresh message or the timeout expires.
