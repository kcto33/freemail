# Freemail Announcement Banner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single admin-managed site announcement that appears as a dismissible top banner for logged-in mailbox users and is hidden for the current browser session after dismissal.

**Architecture:** Extend the existing Worker/D1 backend with one announcement table, small database helpers, and one `/api/announcement` endpoint with read/write behavior. Then add a focused admin-page form for editing the current announcement and a mailbox-app banner renderer that stores dismissal state in `sessionStorage` using the announcement version.

**Tech Stack:** Cloudflare Workers, D1/SQLite, vanilla ES modules, static HTML/CSS, Node test runner via `tsx --test`

---

## File Map

**Create:**

- `F:/yys/email/freemail/.worktrees/cli-read-automation/src/db/announcements.js`
- `F:/yys/email/freemail/.worktrees/cli-read-automation/tests/worker/announcement-api.test.js`

**Modify:**

- `F:/yys/email/freemail/.worktrees/cli-read-automation/src/db/index.js`
- `F:/yys/email/freemail/.worktrees/cli-read-automation/src/db/init.js`
- `F:/yys/email/freemail/.worktrees/cli-read-automation/src/api/index.js`
- `F:/yys/email/freemail/.worktrees/cli-read-automation/package.json`
- `F:/yys/email/freemail/.worktrees/cli-read-automation/public/html/admin.html`
- `F:/yys/email/freemail/.worktrees/cli-read-automation/public/js/admin.js`
- `F:/yys/email/freemail/.worktrees/cli-read-automation/public/js/modules/admin/api.js`
- `F:/yys/email/freemail/.worktrees/cli-read-automation/public/html/app.html`
- `F:/yys/email/freemail/.worktrees/cli-read-automation/public/js/app.js`
- `F:/yys/email/freemail/.worktrees/cli-read-automation/public/css/admin.css`
- `F:/yys/email/freemail/.worktrees/cli-read-automation/public/css/app.css`
- `F:/yys/email/freemail/.worktrees/cli-read-automation/public/js/modules/app/ui-helpers.js`

**Responsibilities:**

- `src/db/announcements.js`: announcement row read/write helpers
- `src/db/init.js`: table creation and lightweight migration checks
- `src/api/index.js`: route announcement requests to helper-backed handlers
- `tests/worker/announcement-api.test.js`: read/write behavior, auth restrictions, guest behavior
- `public/html/admin.html` + `public/js/admin.js` + `public/js/modules/admin/api.js`: admin announcement form and save flow
- `public/html/app.html` + `public/js/app.js` + `public/css/app.css`: top banner rendering and dismissal
- `public/js/modules/app/ui-helpers.js`: safe plain-text-to-HTML formatting helper for multiline banner content

### Task 1: Add D1 announcement storage and migration

**Files:**

- Create: `F:/yys/email/freemail/.worktrees/cli-read-automation/src/db/announcements.js`
- Modify: `F:/yys/email/freemail/.worktrees/cli-read-automation/src/db/index.js`
- Modify: `F:/yys/email/freemail/.worktrees/cli-read-automation/src/db/init.js`

- [ ] **Step 1: Write the database helper module**

Create `F:/yys/email/freemail/.worktrees/cli-read-automation/src/db/announcements.js` with the following content:

```js
/**
 * 站点公告数据库操作
 * @module db/announcements
 */

const ANNOUNCEMENT_ID = 1;
const MAX_ANNOUNCEMENT_LENGTH = 500;

function normalizeAnnouncementInput({ content = '', isActive = false, updatedByUserId = null } = {}) {
  const normalizedContent = String(content || '').trim();
  const normalizedActive = !!isActive;
  const normalizedUpdatedBy = Number.isFinite(Number(updatedByUserId)) ? Number(updatedByUserId) : null;

  if (normalizedContent.length > MAX_ANNOUNCEMENT_LENGTH) {
    throw new Error(`公告内容不能超过 ${MAX_ANNOUNCEMENT_LENGTH} 个字符`);
  }

  if (normalizedActive && !normalizedContent) {
    throw new Error('启用公告时内容不能为空');
  }

  return {
    content: normalizedContent,
    isActive: normalizedActive ? 1 : 0,
    updatedByUserId: normalizedUpdatedBy
  };
}

export async function getCurrentAnnouncement(db) {
  const row = await db.prepare(`
    SELECT id, content, is_active, updated_at, updated_by_user_id
    FROM site_announcements
    WHERE id = ?
    LIMIT 1
  `).bind(ANNOUNCEMENT_ID).first();

  if (!row) {
    return {
      active: false,
      content: '',
      updated_at: null,
      updated_by_user_id: null
    };
  }

  return {
    active: !!row.is_active,
    content: row.content || '',
    updated_at: row.updated_at || null,
    updated_by_user_id: row.updated_by_user_id ?? null
  };
}

export async function saveCurrentAnnouncement(db, input) {
  const normalized = normalizeAnnouncementInput(input);

  await db.prepare(`
    INSERT INTO site_announcements (id, content, is_active, updated_at, updated_by_user_id)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?)
    ON CONFLICT(id) DO UPDATE SET
      content = excluded.content,
      is_active = excluded.is_active,
      updated_at = CURRENT_TIMESTAMP,
      updated_by_user_id = excluded.updated_by_user_id
  `).bind(
    ANNOUNCEMENT_ID,
    normalized.content,
    normalized.isActive,
    normalized.updatedByUserId
  ).run();

  return getCurrentAnnouncement(db);
}

export { MAX_ANNOUNCEMENT_LENGTH };
```

- [ ] **Step 2: Export the helper functions**

Update `F:/yys/email/freemail/.worktrees/cli-read-automation/src/db/index.js` to export the new helper module:

```js
export {
  getCurrentAnnouncement,
  saveCurrentAnnouncement,
  MAX_ANNOUNCEMENT_LENGTH
} from './announcements.js';
```

Place that export block alongside the existing database helper exports.

- [ ] **Step 3: Add the table creation and migration path**

Update `F:/yys/email/freemail/.worktrees/cli-read-automation/src/db/init.js` in three places.

Add the fast-existence check inside `performFirstTimeSetup`:

```js
    await db.prepare('SELECT 1 FROM site_announcements LIMIT 1').all();
```

Add the table creation in both the lightweight init path and `setupDatabase`:

```js
  await db.exec("CREATE TABLE IF NOT EXISTS site_announcements (id INTEGER PRIMARY KEY CHECK (id = 1), content TEXT NOT NULL DEFAULT '', is_active INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_by_user_id INTEGER);");
```

Add a helper that ensures the table exists for upgraded deployments where the other tables are already present:

```js
async function migrateAnnouncementTable(db) {
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS site_announcements (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        content TEXT NOT NULL DEFAULT '',
        is_active INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_by_user_id INTEGER
      );
    `);
  } catch (error) {
    console.error('site_announcements 表迁移失败:', error);
  }
}
```

Then call it in `performFirstTimeSetup` immediately before `createCliAuthTables(db)` when the existing tables are already present:

```js
    await migrateAnnouncementTable(db);
```

- [ ] **Step 4: Quick syntax verification**

Run:

```bash
node --check F:/yys/email/freemail/.worktrees/cli-read-automation/src/db/announcements.js
```

Expected: no output, exit code `0`.

- [ ] **Step 5: Commit the storage layer**

Run:

```bash
git -C F:/yys/email/freemail/.worktrees/cli-read-automation add src/db/announcements.js src/db/index.js src/db/init.js
git -C F:/yys/email/freemail/.worktrees/cli-read-automation commit -m "feat: add announcement storage"
```

### Task 2: Add Worker API coverage for reading and updating the current announcement

**Files:**

- Create: `F:/yys/email/freemail/.worktrees/cli-read-automation/tests/worker/announcement-api.test.js`
- Modify: `F:/yys/email/freemail/.worktrees/cli-read-automation/src/api/index.js`
- Modify: `F:/yys/email/freemail/.worktrees/cli-read-automation/package.json`

- [ ] **Step 1: Write the failing Worker tests**

Create `F:/yys/email/freemail/.worktrees/cli-read-automation/tests/worker/announcement-api.test.js` with:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApiRequest } from '../../src/api/index.js';

function createAnnouncementDbStub() {
  const state = {
    row: null
  };

  return {
    state,
    prepare(sql) {
      const bindings = [];
      return {
        bind(...args) {
          bindings.splice(0, bindings.length, ...args);
          return this;
        },
        async all() {
          if (/SELECT id, content, is_active, updated_at, updated_by_user_id FROM site_announcements/i.test(sql)) {
            return { results: state.row ? [state.row] : [] };
          }
          return { results: [] };
        },
        async first() {
          const result = await this.all();
          return result.results[0] || null;
        },
        async run() {
          if (/INSERT INTO site_announcements/i.test(sql)) {
            state.row = {
              id: 1,
              content: bindings[1],
              is_active: bindings[2],
              updated_at: '2026-04-17 20:15:00',
              updated_by_user_id: bindings[3]
            };
          }
          return { success: true };
        }
      };
    },
    async exec() {
      return { success: true };
    }
  };
}

test('GET /api/announcement returns inactive when no row exists', async () => {
  const db = createAnnouncementDbStub();
  const request = new Request('https://freemail.test/api/announcement');

  const response = await handleApiRequest(request, db, [], {
    authPayload: { role: 'user', username: 'alice', userId: 2 }
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    active: false,
    content: '',
    updated_at: null,
    updated_by_user_id: null
  });
});

test('GET /api/announcement returns inactive for guest mode', async () => {
  const db = createAnnouncementDbStub();
  db.state.row = {
    id: 1,
    content: '维护公告',
    is_active: 1,
    updated_at: '2026-04-17 20:15:00',
    updated_by_user_id: 1
  };

  const request = new Request('https://freemail.test/api/announcement');

  const response = await handleApiRequest(request, db, [], {
    authPayload: { role: 'guest', username: 'guest' }
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    active: false,
    content: '',
    updated_at: null,
    updated_by_user_id: null
  });
});

test('PUT /api/announcement rejects non-strict-admin callers', async () => {
  const db = createAnnouncementDbStub();
  const request = new Request('https://freemail.test/api/announcement', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: '维护公告', is_active: true })
  });

  const response = await handleApiRequest(request, db, [], {
    adminName: 'root',
    authPayload: { role: 'admin', username: 'other-admin', userId: 3 }
  });

  assert.equal(response.status, 403);
});

test('PUT /api/announcement saves normalized content for strict admin', async () => {
  const db = createAnnouncementDbStub();
  const request = new Request('https://freemail.test/api/announcement', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: '  今晚维护  ', is_active: true })
  });

  const response = await handleApiRequest(request, db, [], {
    adminName: 'root',
    authPayload: { role: 'admin', username: 'root', userId: 1 }
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    active: true,
    content: '今晚维护',
    updated_at: '2026-04-17 20:15:00',
    updated_by_user_id: 1
  });
});
```

- [ ] **Step 2: Register the test in the package test script**

Update `F:/yys/email/freemail/.worktrees/cli-read-automation/package.json`:

```json
{
  "scripts": {
    "test": "npm run test:worker",
    "test:worker": "tsx --test tests/worker/cli-auth-db.test.js tests/worker/cli-auth-http.test.js tests/worker/asset-manager-cli-auth.test.js tests/worker/email-ownership.test.js tests/worker/announcement-api.test.js"
  }
}
```

- [ ] **Step 3: Run the new test to verify it fails**

Run:

```bash
npm test -- --test-name-pattern="announcement"
```

Expected: FAIL because `/api/announcement` is not implemented yet.

- [ ] **Step 4: Implement the API path**

Update `F:/yys/email/freemail/.worktrees/cli-read-automation/src/api/index.js`.

Add imports:

```js
import { getCurrentAnnouncement, saveCurrentAnnouncement } from '../db/index.js';
import { isStrictAdmin, jsonResponse, errorResponse } from './helpers.js';
```

Add this block near the top of `handleApiRequest`, after the CLI auth handler returns and before the mailbox-only restriction block:

```js
  if (path === '/api/announcement' && request.method === 'GET') {
    const role = options.authPayload?.role || '';
    if (!options.authPayload) {
      return errorResponse('Unauthorized', 401);
    }
    if (role === 'guest') {
      return jsonResponse({
        active: false,
        content: '',
        updated_at: null,
        updated_by_user_id: null
      });
    }

    try {
      return jsonResponse(await getCurrentAnnouncement(db));
    } catch (e) {
      return errorResponse('公告读取失败', 500);
    }
  }

  if (path === '/api/announcement' && request.method === 'PUT') {
    if (!isStrictAdmin(request, options)) {
      return errorResponse('Forbidden', 403);
    }

    try {
      const body = await request.json();
      const saved = await saveCurrentAnnouncement(db, {
        content: body.content,
        isActive: body.is_active,
        updatedByUserId: options.authPayload?.userId || null
      });
      return jsonResponse(saved);
    } catch (e) {
      const message = String(e?.message || e);
      if (message.includes('不能为空') || message.includes('不能超过')) {
        return errorResponse(message, 400);
      }
      return errorResponse(`公告保存失败: ${message}`, 500);
    }
  }
```

- [ ] **Step 5: Run the announcement tests**

Run:

```bash
npm test -- --test-name-pattern="announcement"
```

Expected: the new announcement tests PASS.

- [ ] **Step 6: Run the full Worker test suite**

Run:

```bash
npm test
```

Expected: all worker tests PASS, including the existing CLI auth and email ownership tests.

- [ ] **Step 7: Commit the API slice**

Run:

```bash
git -C F:/yys/email/freemail/.worktrees/cli-read-automation add package.json src/api/index.js tests/worker/announcement-api.test.js
git -C F:/yys/email/freemail/.worktrees/cli-read-automation commit -m "feat: add announcement api"
```

### Task 3: Add admin-page announcement management UI

**Files:**

- Modify: `F:/yys/email/freemail/.worktrees/cli-read-automation/public/html/admin.html`
- Modify: `F:/yys/email/freemail/.worktrees/cli-read-automation/public/js/modules/admin/api.js`
- Modify: `F:/yys/email/freemail/.worktrees/cli-read-automation/public/js/admin.js`
- Modify: `F:/yys/email/freemail/.worktrees/cli-read-automation/public/css/admin.css`

- [ ] **Step 1: Extend the admin API client**

Update `F:/yys/email/freemail/.worktrees/cli-read-automation/public/js/modules/admin/api.js` with:

```js
export async function getAnnouncement() {
  const r = await api('/api/announcement');
  return r.json();
}

export async function saveAnnouncement(data) {
  const r = await api('/api/announcement', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(text || '保存公告失败');
  }
  return r.json();
}
```

Also add them to the default export object.

- [ ] **Step 2: Add the announcement card markup**

Insert this card into the left-side column in `F:/yys/email/freemail/.worktrees/cli-read-automation/public/html/admin.html`, directly below the existing “管理操作” card:

```html
<div class="card announcement-card" id="announcement-card" style="display:none">
  <div class="card-header">
    <h2>
      <span class="card-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
      </span>
      <span>站点公告</span>
    </h2>
  </div>
  <div class="announcement-form">
    <div class="form-group">
      <label class="form-label" for="announcement-content">公告内容</label>
      <textarea id="announcement-content" class="input announcement-textarea" rows="4" maxlength="500" placeholder="例如：今晚 23:00 到 23:30 短暂维护"></textarea>
      <div class="help-text">
        仅对已登录用户显示。关闭仅在当前浏览器会话生效。
      </div>
    </div>
    <div class="announcement-toolbar">
      <label class="toggle-label">
        <input id="announcement-active" type="checkbox" class="toggle-input" />
        <span class="toggle-switch"></span>
        <span class="toggle-text">启用公告</span>
      </label>
      <button id="announcement-save" class="btn btn-primary">保存公告</button>
    </div>
  </div>
</div>
```

- [ ] **Step 3: Style the card without changing the existing page language**

Append this to `F:/yys/email/freemail/.worktrees/cli-read-automation/public/css/admin.css`:

```css
.announcement-card {
  overflow: hidden;
}

.announcement-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.announcement-textarea {
  min-height: 110px;
  resize: vertical;
}

.announcement-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

@media (max-width: 768px) {
  .announcement-toolbar {
    flex-direction: column;
    align-items: stretch;
  }
}
```

- [ ] **Step 4: Wire the admin screen behavior**

Update `F:/yys/email/freemail/.worktrees/cli-read-automation/public/js/admin.js`.

Change the import line to include the new helpers:

```js
import { api, getUsers, createUser, updateUser, deleteUser, getUserMailboxes, assignMailbox, unassignMailbox, getAnnouncement, saveAnnouncement } from './modules/admin/api.js';
```

Add DOM references:

```js
  announcementCard: document.getElementById('announcement-card'),
  announcementContent: document.getElementById('announcement-content'),
  announcementActive: document.getElementById('announcement-active'),
  announcementSave: document.getElementById('announcement-save'),
```

Add two functions:

```js
async function loadAnnouncement() {
  try {
    const sessionResp = await api('/api/session');
    const session = await sessionResp.json();
    if (!session?.strictAdmin) {
      if (els.announcementCard) els.announcementCard.style.display = 'none';
      return;
    }

    if (els.announcementCard) els.announcementCard.style.display = '';
    const data = await getAnnouncement();
    if (els.announcementContent) els.announcementContent.value = data.content || '';
    if (els.announcementActive) els.announcementActive.checked = !!data.active;
  } catch (e) {
    console.error('加载公告失败:', e);
    if (els.announcementCard) els.announcementCard.style.display = 'none';
  }
}

async function handleSaveAnnouncement() {
  const content = els.announcementContent?.value || '';
  const isActive = !!els.announcementActive?.checked;

  try {
    if (els.announcementSave) els.announcementSave.disabled = true;
    const saved = await saveAnnouncement({
      content,
      is_active: isActive
    });
    if (els.announcementContent) els.announcementContent.value = saved.content || '';
    if (els.announcementActive) els.announcementActive.checked = !!saved.active;
    showToast('公告已保存', 'success');
  } catch (e) {
    showToast(e.message || '公告保存失败', 'error');
  } finally {
    if (els.announcementSave) els.announcementSave.disabled = false;
  }
}
```

Bind the event and load on startup:

```js
els.announcementSave?.addEventListener('click', handleSaveAnnouncement);
loadAnnouncement();
```

- [ ] **Step 5: Manual admin-page verification**

Run the app locally or deploy to a test Worker, then verify:

```text
1. Strict admin can see the announcement card.
2. Guest mode does not show the announcement card.
3. Saving an active announcement shows a success toast.
4. Saving an empty active announcement shows an error toast.
5. Disabling the announcement persists and reloads correctly.
```

- [ ] **Step 6: Commit the admin UI**

Run:

```bash
git -C F:/yys/email/freemail/.worktrees/cli-read-automation add public/html/admin.html public/js/modules/admin/api.js public/js/admin.js public/css/admin.css
git -C F:/yys/email/freemail/.worktrees/cli-read-automation commit -m "feat: add admin announcement controls"
```

### Task 4: Render the mailbox-app top banner and session dismissal logic

**Files:**

- Modify: `F:/yys/email/freemail/.worktrees/cli-read-automation/public/html/app.html`
- Modify: `F:/yys/email/freemail/.worktrees/cli-read-automation/public/js/app.js`
- Modify: `F:/yys/email/freemail/.worktrees/cli-read-automation/public/js/modules/app/ui-helpers.js`
- Modify: `F:/yys/email/freemail/.worktrees/cli-read-automation/public/css/app.css`

- [ ] **Step 1: Add a safe multiline formatter**

Append this helper to `F:/yys/email/freemail/.worktrees/cli-read-automation/public/js/modules/app/ui-helpers.js`:

```js
export function formatPlainTextMultiline(str) {
  return escapeHtml(str).replace(/\r?\n/g, '<br>');
}
```

Also add it to the default export object.

- [ ] **Step 2: Add the banner slot to the app shell**

Insert this block in `F:/yys/email/freemail/.worktrees/cli-read-automation/public/html/app.html` immediately after the closing `</div>` of `.topbar` and before `<div class="toast" id="toast"></div>`:

```html
<div id="announcement-banner" class="announcement-banner" style="display:none">
  <div class="announcement-banner__content">
    <div id="announcement-banner-text" class="announcement-banner__text"></div>
    <button id="announcement-banner-close" class="announcement-banner__close" type="button" aria-label="关闭公告">×</button>
  </div>
</div>
```

- [ ] **Step 3: Style the banner**

Append this to `F:/yys/email/freemail/.worktrees/cli-read-automation/public/css/app.css`:

```css
.announcement-banner {
  max-width: 1200px;
  margin: 12px auto 0;
  padding: 0 24px;
}

.announcement-banner__content {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  border-radius: 16px;
  background: linear-gradient(135deg, rgba(255, 244, 214, 0.96), rgba(255, 237, 188, 0.92));
  border: 1px solid rgba(232, 181, 66, 0.35);
  color: #6b4e00;
  box-shadow: 0 10px 24px rgba(232, 181, 66, 0.12);
}

.announcement-banner__text {
  font-size: 14px;
  font-weight: 500;
  line-height: 1.7;
}

.announcement-banner__close {
  border: none;
  background: rgba(107, 78, 0, 0.08);
  color: #6b4e00;
  width: 32px;
  height: 32px;
  border-radius: 999px;
  cursor: pointer;
  flex: 0 0 auto;
  transition: var(--transition-fast);
}

.announcement-banner__close:hover {
  background: rgba(107, 78, 0, 0.16);
  transform: scale(1.06);
}

@media (max-width: 768px) {
  .announcement-banner {
    padding: 0 16px;
  }

  .announcement-banner__content {
    gap: 10px;
    padding: 12px 14px;
  }

  .announcement-banner__text {
    font-size: 13px;
  }
}
```

- [ ] **Step 4: Add fetch/render/dismiss logic to the app entry**

Update `F:/yys/email/freemail/.worktrees/cli-read-automation/public/js/app.js`.

Change the helper import:

```js
import { formatTs, formatTsMobile, extractCode, escapeHtml, escapeAttr, formatPlainTextMultiline } from './modules/app/ui-helpers.js';
```

Add DOM references:

```js
  announcementBanner: document.getElementById('announcement-banner'),
  announcementBannerText: document.getElementById('announcement-banner-text'),
  announcementBannerClose: document.getElementById('announcement-banner-close'),
```

Add helper functions after `updateMailboxInfoUI`:

```js
function getAnnouncementDismissKey(updatedAt) {
  return `freemail:announcement:dismissed:${updatedAt || 'none'}`;
}

function hideAnnouncementBanner() {
  if (els.announcementBanner) els.announcementBanner.style.display = 'none';
  if (els.announcementBannerText) els.announcementBannerText.innerHTML = '';
}

async function loadAnnouncementBanner(session) {
  if (!session || session.role === 'guest') {
    hideAnnouncementBanner();
    return;
  }

  try {
    const response = await api('/api/announcement');
    if (!response.ok) {
      hideAnnouncementBanner();
      return;
    }

    const data = await response.json();
    if (!data.active || !data.content || !data.updated_at) {
      hideAnnouncementBanner();
      return;
    }

    const dismissKey = getAnnouncementDismissKey(data.updated_at);
    if (sessionStorage.getItem(dismissKey) === '1') {
      hideAnnouncementBanner();
      return;
    }

    if (els.announcementBannerText) {
      els.announcementBannerText.innerHTML = formatPlainTextMultiline(data.content);
    }
    if (els.announcementBannerClose) {
      els.announcementBannerClose.onclick = () => {
        try { sessionStorage.setItem(dismissKey, '1'); } catch (_) {}
        hideAnnouncementBanner();
      };
    }
    if (els.announcementBanner) els.announcementBanner.style.display = 'block';
  } catch (_) {
    hideAnnouncementBanner();
  }
}
```

Then call it in the main async bootstrap right after `validateSession()` succeeds:

```js
  await loadAnnouncementBanner(s);
```

- [ ] **Step 5: Manual mailbox-page verification**

Verify this exact flow in a browser:

```text
1. Log in as a normal user after enabling an announcement in admin.
2. Confirm the banner shows directly below the topbar.
3. Refresh the page and confirm the banner still shows before closing it.
4. Click the close button and confirm the banner disappears.
5. Refresh the page in the same browser session and confirm it stays hidden.
6. Close the browser session, reopen it, and confirm the banner appears again.
7. Update the announcement content as admin and confirm the new banner appears again.
```

- [ ] **Step 6: Final regression run**

Run:

```bash
npm test
```

Expected: all worker tests PASS.

Also verify visually on mobile-width DevTools:

```text
1. Banner text wraps cleanly.
2. Close button remains clickable.
3. Banner does not overlap the sticky topbar or the main content.
```

- [ ] **Step 7: Commit the frontend banner**

Run:

```bash
git -C F:/yys/email/freemail/.worktrees/cli-read-automation add public/html/app.html public/js/app.js public/js/modules/app/ui-helpers.js public/css/app.css
git -C F:/yys/email/freemail/.worktrees/cli-read-automation commit -m "feat: add announcement banner"
```
