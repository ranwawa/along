import type { Database } from 'bun:sqlite';

interface TableInfoRow {
  name: string;
}

export function hasLegacyTaskStatusColumn(
  db: Pick<Database, 'prepare'>,
): boolean {
  try {
    const rows = db
      .prepare('PRAGMA table_info(task_items)')
      .all() as TableInfoRow[];
    return rows.some((row) => row.name === 'status');
  } catch {
    return false;
  }
}
