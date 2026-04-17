# Freemail Announcement Banner Design

Date: 2026-04-17
Project: `freemail`
Scope: single current site announcement for logged-in users

## Summary

This design adds a small site-wide announcement capability to `freemail`.

The selected scope is:

- one current announcement only
- managed from the existing admin page
- shown only to logged-in mailbox users
- rendered as a dismissible top banner in the mailbox app
- dismissal remembered only for the current browser session

The goal is to add a useful notice channel without turning the project into a CMS.

## Goals

- Let an admin publish or disable one current announcement from the website.
- Show the announcement prominently on the logged-in mailbox page.
- Let each user close the banner for the current browser session.
- Keep the implementation small and consistent with the existing Worker + D1 + static-frontend structure.

## Non-Goals

- Announcement history or multiple concurrent announcements.
- Rich text, Markdown, attachments, links management, or scheduling.
- Per-user persistent dismissal state in the database.
- Showing announcements on the login page.
- Showing announcements in guest/demo mode.

## Current State

The current project already has the right structure for a narrow feature:

- the Worker entry lives in [src/server.js](F:/yys/email/freemail/.worktrees/cli-read-automation/src/server.js)
- API dispatch is centralized in [src/api/index.js](F:/yys/email/freemail/.worktrees/cli-read-automation/src/api/index.js)
- D1 table creation and lightweight migrations live in [src/db/init.js](F:/yys/email/freemail/.worktrees/cli-read-automation/src/db/init.js)
- the logged-in mailbox UI is composed from [public/html/app.html](F:/yys/email/freemail/.worktrees/cli-read-automation/public/html/app.html) and [public/js/app.js](F:/yys/email/freemail/.worktrees/cli-read-automation/public/js/app.js)
- the admin UI already manages site data through a dedicated page: [public/html/admin.html](F:/yys/email/freemail/.worktrees/cli-read-automation/public/html/admin.html) and [public/js/admin.js](F:/yys/email/freemail/.worktrees/cli-read-automation/public/js/admin.js)

This means the feature can be added as one small database unit, one API slice, one admin card, and one frontend banner component.

## Recommended Approach

Use a dedicated announcement table in D1 and expose one shared API path:

- `GET /api/announcement`
- `PUT /api/announcement`

Behavior:

- `GET` returns the current active announcement for authenticated mailbox users
- `PUT` updates the current announcement and is restricted to strict admins

On the frontend:

- the mailbox app fetches the current announcement after session validation
- the announcement renders as a horizontal banner directly under the sticky topbar
- the user can dismiss it with a close button
- dismissal is stored in `sessionStorage`, keyed by the current announcement version

This keeps the feature small, avoids per-user database state, and matches the exact dismissal rule that was selected.

## Data Model

Add one table for the current site announcement.

Recommended table:

```sql
CREATE TABLE IF NOT EXISTS site_announcements (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  content TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by_user_id INTEGER
);
```

Notes:

- the table is intentionally single-row
- `id = 1` keeps reads and writes simple
- `content` stores plain text only
- `is_active` controls whether the banner is shown
- `updated_at` acts as the announcement version for session dismissal
- `updated_by_user_id` is optional but useful for traceability later

This should be created from the existing lightweight init/migration path in [src/db/init.js](F:/yys/email/freemail/.worktrees/cli-read-automation/src/db/init.js), following the same style used for other additive schema changes.

## API Design

### `GET /api/announcement`

Purpose:

- fetch the current active announcement for the mailbox app

Access:

- authenticated real users only
- no guest/demo mode support in this slice

Response rules:

- if there is no active announcement, return a small success payload with `active: false`
- if the current session is guest/demo mode, also return `active: false`
- if there is an active announcement, return the content and version metadata

Recommended payload:

```json
{
  "active": true,
  "content": "今晚 23:00 到 23:30 短暂维护",
  "updated_at": "2026-04-17 20:15:00"
}
```

### `PUT /api/announcement`

Purpose:

- create, replace, activate, or deactivate the current announcement

Access:

- strict admin only

Request body:

```json
{
  "content": "今晚 23:00 到 23:30 短暂维护",
  "is_active": true
}
```

Write behavior:

- upsert row `id = 1`
- trim content
- allow empty content only when disabling the announcement
- always refresh `updated_at` when the content or active state changes

Response:

- return the normalized saved object

## Frontend Behavior

### Mailbox app

The banner belongs only on the logged-in mailbox application page, not on the login page.

Placement:

- directly below the sticky topbar
- above the main mailbox layout container
- full-width within the same centered page frame

Visual behavior:

- one horizontal banner
- clear message text
- dismiss button on the right
- subdued but noticeable styling, closer to a system notice than a marketing card

Dismissal behavior:

- store dismissal only in `sessionStorage`
- derive the storage key from `updated_at`, for example:
  - `freemail:announcement:dismissed:<updated_at>`
- when the stored dismissed version matches the current announcement version, do not render the banner
- when the admin updates the announcement, `updated_at` changes and the banner appears again automatically

Fetch timing:

- fetch after `validateSession()` succeeds in [public/js/app.js](F:/yys/email/freemail/.worktrees/cli-read-automation/public/js/app.js)
- if the fetch fails, do not block the mailbox UI; fail quietly and continue rendering the page

Content rendering:

- plain text only
- preserve line breaks safely by escaping HTML first, then converting newlines to `<br>`

### Admin page

Add one new card to the admin page near the existing management controls.

Visibility:

- show the management card only for strict admins
- hide it for guest/demo and non-strict admin views so the page does not present controls that cannot succeed

Recommended fields:

- multiline textarea for announcement content
- active/inactive switch
- save button

Optional first-slice helper text:

- explain that an empty disabled announcement means no banner will be shown
- explain that user dismissal lasts only for the current browser session

Admin save flow:

1. admin edits content or active state
2. clicks save
3. frontend sends `PUT /api/announcement`
4. success toast confirms publish/update
5. failure toast leaves the form contents intact

The admin page does not need to show the banner itself in this slice.

## Component Boundaries

Keep the feature split into small focused units:

- database read/write helpers for announcement data
- API handler branch for `/api/announcement`
- admin-page UI helpers for loading/saving the announcement form
- mailbox-app banner renderer and dismissal helper

This avoids mixing announcement behavior into user, mailbox, or email logic.

## Error Handling

### Read path

- unauthenticated request: existing auth behavior should apply
- guest/demo mode: return `200` with `active: false`
- database read failure: return `500`; frontend should silently skip the banner

### Write path

- non-admin caller: `403`
- active announcement with empty content: `400`
- oversized content: `400`
- database write failure: `500`

Recommended content limit:

- `500` characters maximum for the first slice

This keeps the banner readable on mobile and avoids turning it into a full article.

## Testing Strategy

### Worker tests

Add tests for:

- `GET /api/announcement` when no announcement exists
- `GET /api/announcement` when an active announcement exists
- `PUT /api/announcement` denied for non-admin callers
- `PUT /api/announcement` saves and normalizes content for strict admin
- disabled announcement no longer reports as active

### Frontend verification

Manually verify:

1. strict admin can save an active announcement
2. logged-in mailbox user sees the banner after page load
3. clicking close hides the banner
4. refreshing within the same browser session keeps it hidden
5. opening a new browser session shows it again
6. admin updates the announcement and the new banner shows again
7. disabling the announcement removes it for everyone

### Mobile check

Verify that:

- long text wraps without overlapping the close button
- the banner still looks correct under the sticky topbar on narrow screens

## Implementation Sequence

Recommended order:

1. add D1 table creation and helper functions
2. add `/api/announcement` read/write handling with admin enforcement on writes
3. add admin-page announcement card and save flow
4. add mailbox-app banner rendering and session dismissal logic
5. add Worker tests and run manual UI verification

## Deferred Work

The following are intentionally deferred:

- announcement history
- start/end scheduling
- announcement severity levels such as info/warning/error
- Markdown or rich text support
- per-user persistent dismissal
- showing the announcement on additional pages such as login or admin

## Design Decisions Locked In

- one current announcement only
- admin edits it from the existing admin page
- announcement is shown only to logged-in mailbox users
- guest/demo mode does not show the announcement
- the mailbox app uses a top banner with a close button
- closing the banner is remembered only in the current browser session
- the dismissal key is derived from the announcement version so a new announcement reappears automatically
