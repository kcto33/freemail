/**
 * 站点公告数据库操作模块
 * @module db/announcements
 */

const ANNOUNCEMENT_ID = 1;

export const MAX_ANNOUNCEMENT_LENGTH = 500;

function parseAnnouncementActive(value) {
  if (value === true || value === 1) {
    return true;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
  }

  return false;
}

function normalizeAnnouncementInput(input = {}) {
  const content = String(input.content ?? '').trim();
  const isActive = parseAnnouncementActive(input.active ?? input.isActive ?? input.is_active ?? false);
  const updatedByUserIdRaw = input.updatedByUserId ?? input.updated_by_user_id ?? null;
  const updatedByUserId =
    updatedByUserIdRaw === null || updatedByUserIdRaw === undefined || String(updatedByUserIdRaw).trim() === ''
      ? null
      : Number.isFinite(Number(updatedByUserIdRaw))
        ? Number(updatedByUserIdRaw)
        : null;

  if (content.length > MAX_ANNOUNCEMENT_LENGTH) {
    throw new Error(`公告内容不能超过 ${MAX_ANNOUNCEMENT_LENGTH} 个字符`);
  }

  if (isActive && !content) {
    throw new Error('启用公告时内容不能为空');
  }

  return {
    active: isActive,
    content,
    updatedByUserId
  };
}

/**
 * 获取当前站点公告
 * @param {object} db - 数据库连接对象
 * @returns {Promise<{active: boolean, content: string, updated_at: string|null, updated_by_user_id: number|null}>}
 */
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

/**
 * 保存当前站点公告
 * @param {object} db - 数据库连接对象
 * @param {object} input - 公告输入
 * @returns {Promise<{active: boolean, content: string, updated_at: string|null, updated_by_user_id: number|null}>}
 */
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
    normalized.active ? 1 : 0,
    normalized.updatedByUserId
  ).run();

  return getCurrentAnnouncement(db);
}
