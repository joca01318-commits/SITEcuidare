import { DatabaseSync, type StatementSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { MIGRATIONS } from "./schema.js";

export type Row = Record<string, unknown>;
type Param = string | number | bigint | null | Uint8Array;
type Params = Param[] | Record<string, Param>;

/**
 * Camada fina sobre o SQLite embutido no Node (escrito em C, com WAL, FTS5 e JSON).
 * O banco é um arquivo local: nada depende de serviço externo.
 */
export class Db {
  readonly raw: DatabaseSync;
  private cache = new Map<string, StatementSync>();
  private depth = 0;

  constructor(file: string) {
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    this.raw = new DatabaseSync(file);
    this.raw.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      PRAGMA temp_store = MEMORY;
      PRAGMA cache_size = -16000;
    `);
  }

  private stmt(sql: string): StatementSync {
    let s = this.cache.get(sql);
    if (!s) {
      s = this.raw.prepare(sql);
      this.cache.set(sql, s);
    }
    return s;
  }

  private bind(params?: Params): Param[] {
    if (!params) return [];
    return Array.isArray(params) ? params : [params as unknown as Param];
  }

  get<T = Row>(sql: string, params?: Params): T | undefined {
    const s = this.stmt(sql);
    return (Array.isArray(params) || !params ? s.get(...this.bind(params)) : s.get(params)) as T | undefined;
  }

  all<T = Row>(sql: string, params?: Params): T[] {
    const s = this.stmt(sql);
    return (Array.isArray(params) || !params ? s.all(...this.bind(params)) : s.all(params)) as T[];
  }

  run(sql: string, params?: Params): { changes: number; lastInsertRowid: number } {
    const s = this.stmt(sql);
    const r = Array.isArray(params) || !params ? s.run(...this.bind(params)) : s.run(params);
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }

  exec(sql: string) {
    this.raw.exec(sql);
  }

  /** Transação (aninhável via SAVEPOINT). Desfaz tudo se a função lançar erro. */
  tx<T>(fn: () => T): T {
    const name = `sp${this.depth}`;
    if (this.depth === 0) this.raw.exec("BEGIN IMMEDIATE");
    else this.raw.exec(`SAVEPOINT ${name}`);
    this.depth++;
    try {
      const out = fn();
      this.depth--;
      if (this.depth === 0) this.raw.exec("COMMIT");
      else this.raw.exec(`RELEASE ${name}`);
      return out;
    } catch (e) {
      this.depth--;
      if (this.depth === 0) this.raw.exec("ROLLBACK");
      else this.raw.exec(`ROLLBACK TO ${name}; RELEASE ${name}`);
      throw e;
    }
  }

  migrate() {
    this.raw.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
    const done = new Set(this.all<{ version: number }>("SELECT version FROM schema_migrations").map((r) => r.version));
    MIGRATIONS.forEach((sql, i) => {
      const version = i + 1;
      if (done.has(version)) return;
      this.tx(() => {
        this.raw.exec(sql);
        this.run("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)", [version, new Date().toISOString()]);
      });
    });
  }

  close() {
    this.raw.close();
  }
}

export function json<T>(v: unknown, fallback: T): T {
  if (typeof v !== "string" || !v) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}
