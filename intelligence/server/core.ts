import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { Db } from "./db/db.js";
import type { Config } from "./config.js";
import type { Role } from "../shared/types.js";

/** Quem está fazendo a operação. Toda função de domínio recebe um Actor. */
export interface Actor {
  id: string;
  orgId: string;
  name: string;
  email: string;
  role: Role;
  scopeAll: boolean;
  /** Clientes permitidos quando scopeAll = false. */
  clientIds: Set<string>;
  ip?: string;
}

export interface Core {
  cfg: Config;
  db: Db;
  /** Chave secreta local (HMAC dos códigos de convite). Nunca vai para o banco. */
  pepper: Buffer;
  bus: EventEmitter;
  paths: { data: string; files: string; backups: string; logs: string };
}

export function createCore(cfg: Config, dbFile?: string): Core {
  const paths = {
    data: cfg.dataDir,
    files: path.join(cfg.dataDir, "files"),
    backups: path.join(cfg.dataDir, "backups"),
    logs: path.join(cfg.dataDir, "logs"),
  };
  for (const p of Object.values(paths)) fs.mkdirSync(p, { recursive: true, mode: 0o700 });

  const keyFile = path.join(paths.data, "secret.key");
  if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, crypto.randomBytes(32).toString("hex"), { mode: 0o600 });
  const pepper = Buffer.from(fs.readFileSync(keyFile, "utf8").trim(), "hex");

  const db = new Db(dbFile ?? path.join(paths.data, "cuidare.sqlite"));
  db.migrate();

  const bus = new EventEmitter();
  bus.setMaxListeners(500);

  return { cfg, db, pepper, bus, paths };
}

export function ensureOrganization(core: Core, name = "Cuidare"): string {
  const row = core.db.get<{ id: string }>("SELECT id FROM organizations ORDER BY created_at LIMIT 1");
  if (row) return row.id;
  const id = "org_" + crypto.randomBytes(8).toString("base64url");
  core.db.run("INSERT INTO organizations (id, name, created_at) VALUES (?, ?, ?)", [id, name, new Date().toISOString()]);
  return id;
}
