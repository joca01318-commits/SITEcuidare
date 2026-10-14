import fs from "node:fs";
import path from "node:path";
import type { Actor, Core } from "../core.js";
import { audit } from "./audit.js";
import { purgeTrash } from "./spreadsheets.js";

/**
 * Backup consistente do banco (VACUUM INTO gera uma cópia íntegra mesmo com o sistema em uso).
 * Mantém os N mais recentes. Os arquivos originais importados ficam em DATA_DIR/files.
 */
export function runBackup(core: Core, actor: Actor | null, reason = "automático") {
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
  const file = path.join(core.paths.backups, `cuidare-${stamp}.sqlite`);
  core.db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  fs.chmodSync(file, 0o600);
  const all = listBackups(core);
  for (const old of all.slice(core.cfg.backupKeep)) fs.rmSync(path.join(core.paths.backups, old.name), { force: true });
  const orgs = core.db.all<{ id: string }>("SELECT id FROM organizations");
  for (const o of orgs)
    audit(core, actor, { source: actor ? "ui" : "system", action: "backup.create", entityType: "system", summary: `Backup ${reason} criado (${path.basename(file)})` }, o.id);
  return path.basename(file);
}

export function listBackups(core: Core) {
  if (!fs.existsSync(core.paths.backups)) return [];
  return fs
    .readdirSync(core.paths.backups)
    .filter((f) => f.endsWith(".sqlite"))
    .map((name) => {
      const st = fs.statSync(path.join(core.paths.backups, name));
      return { name, size: st.size, createdAt: st.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Política de retenção: sessões vencidas, limites de tentativa, ações pendentes e lixeira. */
export function housekeeping(core: Core) {
  const now = new Date().toISOString();
  core.db.run("DELETE FROM sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)", [now, new Date(Date.now() - 7 * 86_400_000).toISOString()]);
  core.db.run("DELETE FROM rate_events WHERE at < ?", [Date.now() - 86_400_000]);
  core.db.run("UPDATE pending_actions SET status = 'expired' WHERE status = 'pending' AND expires_at < ?", [now]);
  const purged = purgeTrash(core);
  return { purged };
}

export function startSchedulers(core: Core, log: (msg: string) => void) {
  const timers: NodeJS.Timeout[] = [];
  const backupEvery = core.cfg.backupEveryHours * 3_600_000;
  if (backupEvery > 0) {
    const tick = () => {
      try {
        const last = listBackups(core)[0];
        if (!last || Date.now() - Date.parse(last.createdAt) >= backupEvery - 60_000) log(`backup criado: ${runBackup(core, null)}`);
      } catch (e) {
        log(`falha no backup: ${(e as Error).message}`);
      }
    };
    timers.push(setTimeout(tick, 30_000));
    timers.push(setInterval(tick, Math.min(backupEvery, 3_600_000)));
  }
  timers.push(
    setInterval(() => {
      try {
        housekeeping(core);
      } catch (e) {
        log(`falha na manutenção: ${(e as Error).message}`);
      }
    }, 3_600_000),
  );
  for (const t of timers) t.unref();
  return () => timers.forEach((t) => clearInterval(t));
}
