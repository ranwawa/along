import { Database } from 'bun:sqlite';
import path from 'node:path';
import { getErrorMessage } from './common';
import { config } from './config';
import { initSchema } from './db-schema';
import type { Result } from './result';
import { failure, success } from './result';

let _db: Database | null = null;

export function getDb(): Result<Database> {
  if (_db) return success(_db);

  const dbPath = path.join(config.USER_ALONG_DIR, 'along.db');
  config.ensureDataDirs();

  try {
    _db = new Database(dbPath);
    _db.exec('PRAGMA journal_mode = WAL');
    _db.exec('PRAGMA foreign_keys = ON');
    _db.exec('PRAGMA busy_timeout = 5000');
    initSchema(_db);
    return success(_db);
  } catch (error: unknown) {
    return failure(`打开数据库失败: ${getErrorMessage(error)}`);
  }
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
