// Thin typed wrappers around D1's API.

export type SqlValue = string | number | null;

export async function queryOne<T>(db: D1Database, sql: string, ...params: SqlValue[]): Promise<T | null> {
  return db.prepare(sql).bind(...params).first<T>();
}

export async function queryAll<T>(db: D1Database, sql: string, ...params: SqlValue[]): Promise<T[]> {
  const result = await db.prepare(sql).bind(...params).all<T>();
  return result.results ?? [];
}

export async function execute(db: D1Database, sql: string, ...params: SqlValue[]): Promise<D1Result> {
  return db.prepare(sql).bind(...params).run();
}

/** LIKE pattern with % and _ escaped; pair with ESCAPE '\' in the query. */
export function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

export function boolToInt(value: boolean): number {
  return value ? 1 : 0;
}
