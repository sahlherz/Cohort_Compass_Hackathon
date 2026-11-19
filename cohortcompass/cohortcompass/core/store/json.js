// Storage adapter: JSON files on disk (demo). Production swaps in a Postgres + pgvector adapter
// implementing the same interface: get, put, list, query, remove, count, all.
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';

export const COLLECTIONS = ['campus', 'courses', 'instructors', 'reviews', 'gtks', 'posts', 'events', 'profiles', 'outcomes', 'interviews', 'idempotency'];

export function createJsonStore(dir) {
  mkdirSync(dir, { recursive: true });
  const mem = {};
  const file = (c) => join(dir, `${c}.json`);
  for (const c of COLLECTIONS) mem[c] = existsSync(file(c)) ? JSON.parse(readFileSync(file(c), 'utf8')) : {};
  const flush = (c) => {
    const tmp = file(c) + '.tmp';
    writeFileSync(tmp, JSON.stringify(mem[c], null, 1));
    renameSync(tmp, file(c)); // atomic replace
  };
  const enc = (n) => Buffer.from(String(n)).toString('base64url');
  const dec = (s) => (s ? Number(Buffer.from(s, 'base64url').toString()) : 0);
  return {
    kind: 'json',
    get: (c, id) => mem[c][id] ?? null,
    put(c, rec) { mem[c][rec.id] = rec; flush(c); return rec; },
    putMany(c, recs) { for (const r of recs) mem[c][r.id] = r; flush(c); },
    remove(c, id) { delete mem[c][id]; flush(c); },
    all: (c) => Object.values(mem[c]),
    count: (c) => Object.keys(mem[c]).length,
    /** Paginated filter. Returns {items, next_cursor, total}. */
    list(c, { filter = () => true, limit = 50, cursor = null, sort } = {}) {
      let rows = Object.values(mem[c]).filter(filter);
      if (sort) rows.sort(sort);
      const start = dec(cursor);
      const items = rows.slice(start, start + limit);
      return { items, next_cursor: start + limit < rows.length ? enc(start + limit) : null, total: rows.length };
    },
    reset() { for (const c of COLLECTIONS) { mem[c] = {}; flush(c); } },
  };
}
