import type { Core, Actor } from "../core.js";
import type { AuditDetail, AuditEvent, AuditSource } from "../../shared/types.js";
import { json } from "../db/db.js";
import { nowIso } from "../lib/util.js";
import { can } from "./access.js";

export interface AuditInput {
  source: AuditSource;
  action: string;
  entityType: string;
  entityId?: string | null;
  spreadsheetId?: string | null;
  clientId?: string | null;
  summary: string;
  details?: AuditDetail[] | Record<string, unknown> | null;
}

/** Registra um evento de auditoria (append-only; protegido por trigger no banco). */
export function audit(core: Core, actor: Actor | null, input: AuditInput, orgId?: string): number {
  const r = core.db.run(
    `INSERT INTO audit_events (org_id, at, user_id, user_name, source, action, entity_type, entity_id, spreadsheet_id, client_id, summary, details, ip)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      actor?.orgId ?? orgId ?? "",
      nowIso(),
      actor?.id ?? null,
      actor?.name ?? null,
      input.source,
      input.action,
      input.entityType,
      input.entityId ?? null,
      input.spreadsheetId ?? null,
      input.clientId ?? null,
      input.summary.slice(0, 500),
      input.details ? JSON.stringify(input.details) : null,
      actor?.ip ?? null,
    ],
  );
  return r.lastInsertRowid;
}

interface AuditRow {
  seq: number;
  at: string;
  user_name: string | null;
  source: AuditSource;
  action: string;
  summary: string;
  spreadsheet_id: string | null;
  title: string | null;
  client_id: string | null;
  details: string | null;
}

export function listAudit(
  core: Core,
  actor: Actor,
  opts: { spreadsheetId?: string; clientId?: string; before?: number; limit?: number; source?: AuditSource },
): AuditEvent[] {
  const where = ["a.org_id = ?"];
  const params: (string | number)[] = [actor.orgId];
  if (opts.spreadsheetId) {
    where.push("a.spreadsheet_id = ?");
    params.push(opts.spreadsheetId);
  }
  if (opts.clientId) {
    where.push("a.client_id = ?");
    params.push(opts.clientId);
  }
  if (opts.source) {
    where.push("a.source = ?");
    params.push(opts.source);
  }
  if (opts.before) {
    where.push("a.seq < ?");
    params.push(opts.before);
  }
  // Sem permissão ampla, o usuário vê apenas o histórico das planilhas que ele pode abrir
  // (o chamador já validou o acesso à planilha) ou as próprias ações.
  if (!can(actor, "view_audit_all") && !opts.spreadsheetId) {
    where.push("a.user_id = ?");
    params.push(actor.id);
  }
  if (!actor.scopeAll) {
    const ids = [...actor.clientIds];
    where.push(ids.length ? `(a.client_id IN (${ids.map(() => "?").join(",")}) OR a.user_id = ?)` : "a.user_id = ?");
    params.push(...ids, actor.id);
  }
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const rows = core.db.all<AuditRow>(
    `SELECT a.seq, a.at, a.user_name, a.source, a.action, a.summary, a.spreadsheet_id, s.title, a.client_id, a.details
       FROM audit_events a LEFT JOIN spreadsheets s ON s.id = a.spreadsheet_id
      WHERE ${where.join(" AND ")}
      ORDER BY a.seq DESC LIMIT ${limit}`,
    params,
  );
  return rows.map((r) => {
    const details = json<unknown>(r.details, null);
    return {
      seq: r.seq,
      at: r.at,
      userName: r.user_name,
      source: r.source,
      action: r.action,
      summary: r.summary,
      spreadsheetId: r.spreadsheet_id,
      spreadsheetTitle: r.title,
      clientId: r.client_id,
      details: Array.isArray(details) ? (details as AuditDetail[]) : null,
    };
  });
}
