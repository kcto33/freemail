/**
 * API 模块统一入口
 * @module api
 */

import { handleUsersApi } from './users.js';
import { handleMailboxesApi } from './mailboxes.js';
import { handleEmailsApi } from './emails.js';
import { handleSendApi } from './send.js';
import { handleCliAuthApi } from './cliAuth.js';
import { getJwtPayload, isStrictAdmin, jsonResponse, errorResponse } from './helpers.js';
import { getCurrentAnnouncement, saveCurrentAnnouncement } from '../db/index.js';

/**
 * 处理所有 API 请求
 * @param {Request} request - HTTP 请求
 * @param {object} db - 数据库连接
 * @param {Array<string>} mailDomains - 邮件域名列表
 * @param {object} options - 选项
 * @returns {Promise<Response>} HTTP 响应
 */
export async function handleApiRequest(request, db, mailDomains, options = {
  mockOnly: false,
  resendApiKey: '',
  adminName: '',
  r2: null,
  authPayload: null,
  mailboxOnly: false
}) {
  const url = new URL(request.url);
  const path = url.pathname;
  const isMock = !!options.mockOnly;

  // CLI auth API
  let response = await handleCliAuthApi(request, db, url, path, options);
  if (response) return response;

  const isMailboxOnly = !!options.mailboxOnly;

  // 邮箱用户只能访问特定的API端点和自己的数据
  if (isMailboxOnly) {
    const payload = getJwtPayload(request, options);
    const mailboxAddress = payload?.mailboxAddress;
    const mailboxId = payload?.mailboxId;
    
    // 允许的API端点
    const allowedPaths = [
      '/api/announcement',
      '/api/emails',
      '/api/email/',
      '/api/auth',
      '/api/quota',
      '/api/mailbox/password'
    ];
    const isAllowedPath = allowedPaths.some(allowedPath => path.startsWith(allowedPath));
    
    if (!isAllowedPath) {
      return errorResponse('访问被拒绝', 403);
    }
    
    // 对于邮件相关API，限制只能访问自己的邮箱
    if (path === '/api/emails' && request.method === 'GET') {
      const requestedMailbox = url.searchParams.get('mailbox');
      if (requestedMailbox && requestedMailbox.toLowerCase() !== mailboxAddress?.toLowerCase()) {
        return errorResponse('只能访问自己的邮箱', 403);
      }
      // 如果没有指定邮箱，自动设置为用户自己的邮箱
      if (!requestedMailbox && mailboxAddress) {
        url.searchParams.set('mailbox', mailboxAddress);
      }
    }
    
    // 对于单个邮件操作，验证邮件是否属于该用户的邮箱
    if (path.startsWith('/api/email/') && mailboxId) {
      const emailId = path.split('/')[3];
      if (emailId && emailId !== 'batch') {
        try {
          const { results } = await db.prepare('SELECT mailbox_id FROM messages WHERE id = ? LIMIT 1').bind(emailId).all();
          if (!results || results.length === 0) {
            return errorResponse('邮件不存在', 404);
          }
          if (results[0].mailbox_id !== mailboxId) {
            return errorResponse('无权访问此邮件', 403);
          }
        } catch (e) {
          return errorResponse('验证失败', 500);
        }
      }
    }
  }

  if (path === '/api/announcement') {
    if (request.method === 'GET') {
      const payload = getJwtPayload(request, options);
      if (!payload) {
        return errorResponse('Unauthorized', 401);
      }

      if (payload.role === 'guest') {
        return jsonResponse({
          active: false,
          content: '',
          updated_at: null,
          updated_by_user_id: null
        });
      }

      try {
        const announcement = await getCurrentAnnouncement(db);
        return jsonResponse(announcement);
      } catch (e) {
        return errorResponse('查询公告失败', 500);
      }
    }

    if (request.method === 'PUT') {
      if (!isStrictAdmin(request, options)) {
        return errorResponse('Forbidden', 403);
      }

      let body;
      try {
        body = await request.json();
      } catch (e) {
        return errorResponse('Malformed JSON', 400);
      }

      try {
        const payload = getJwtPayload(request, options);
        const announcement = await saveCurrentAnnouncement(db, {
          content: body?.content,
          isActive: body?.is_active,
          updatedByUserId: payload?.userId || null
        });
        return jsonResponse(announcement);
      } catch (e) {
        const message = String(e?.message || e || '保存公告失败');
        if (message.includes('公告内容不能超过') || message.includes('启用公告时内容不能为空')) {
          return errorResponse(message, 400);
        }
        return errorResponse('保存公告失败', 500);
      }
    }
  }

  // 依次尝试各个 API 处理器
  // 用户管理 API
  response = await handleUsersApi(request, db, url, path, options);
  if (response) return response;

  // 邮箱管理 API
  response = await handleMailboxesApi(request, db, mailDomains, url, path, options);
  if (response) return response;

  // 邮件 API
  response = await handleEmailsApi(request, db, url, path, options);
  if (response) return response;

  // 发送 API
  response = await handleSendApi(request, db, url, path, options);
  if (response) return response;

  return errorResponse('未找到 API 路径', 404);
}

export { handleUsersApi } from './users.js';
export { handleMailboxesApi } from './mailboxes.js';
export { handleEmailsApi } from './emails.js';
export { handleSendApi } from './send.js';
