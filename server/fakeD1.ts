// Test helper: Cloudflare D1's API over Node's built-in SQLite, enough for server/api.ts.
import { DatabaseSync } from 'node:sqlite';
import type { D1Database, D1Statement } from './api';

export function fakeD1(): D1Database {
  const db = new DatabaseSync(':memory:');
  const statement = (sql: string, values: unknown[] = []): D1Statement => ({
    bind: (...v) => statement(sql, v),
    first: async <T>() => (db.prepare(sql).get(...(values as never[])) as T) ?? null,
    all: async <T>() => ({ results: db.prepare(sql).all(...(values as never[])) as T[] }),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...(values as never[])).changes) } }),
  });
  return { prepare: (sql) => statement(sql) };
}
