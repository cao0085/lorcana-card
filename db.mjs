// 共用的資料庫連線。查卡是唯讀，但 bot 需要寫入 users / messages。
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const dbPath = fileURLToPath(new URL('./data/lorcana.db', import.meta.url));

export const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
