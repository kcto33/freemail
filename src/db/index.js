/**
 * 数据库模块统一导出
 * @module db
 */

export { initDatabase, setupDatabase } from './init.js';
export {
  createCliAuthTables,
  createCliAuthState,
  attachCliAuthCodeToState,
  exchangeCliCodeForToken,
  findCliTokenByValue,
  revokeCliTokenByValue,
} from './cliAuth.js';
export { getDatabaseWithValidation, getInitializedDatabase } from './connection.js';
export {
  getCurrentAnnouncement,
  saveCurrentAnnouncement,
  MAX_ANNOUNCEMENT_LENGTH,
} from './announcements.js';
export {
  getOrCreateMailboxId,
  getMailboxIdByAddress,
  checkMailboxOwnership,
  toggleMailboxPin,
  getTotalMailboxCount,
  getForwardTarget
} from './mailboxes.js';
export {
  createUser,
  updateUser,
  deleteUser,
  listUsersWithCounts,
  assignMailboxToUser,
  getUserMailboxes,
  unassignMailboxFromUser
} from './users.js';
export {
  recordSentEmail,
  updateSentEmail
} from './sentEmails.js';
