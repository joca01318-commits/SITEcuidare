import type { Actor, Core } from "../core.js";
import type { ClientSummary } from "../../shared/types.js";
import { nameKey, normalize, prettyName, wordsMatch } from "../../shared/text.js";
import { json } from "../db/db.js";
import { badRequest, forbidden, newId, notFound, nowIso } from "../lib/util.js";
import { audit } from "./audit.js";
import { canSeeClient, clientScopeSql, require } from "./access.js";
import type { AuditSource } from "../../shared/types.js";
import { indexClient, removeFromIndex } from "./search.js";

interface ClientRow {
  id: string;
  org_id: string;
  name: string;
  name_key: string;
  aliases: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export function listClients(core: Core, actor: Actor, opts: { q?: string; includeArchived?: boolean } = {}): ClientSummary[] {
  const scope = clientScopeSql(actor, "c.id");
  const rows = core.db.all<ClientRow & { sheets: number; last_activity: string | null }>(
    `SELECT c.*,
            (SELECT COUNT(DISTINCT s.id) FROM spreadsheets s
               WHERE s.deleted_at IS NULL AND (s.client_id = c.id OR EXISTS (
                 SELECT 1 FROM records r WHERE r.spreadsheet_id = s.id AND r.client_id = c.id AND r.deleted_at IS NULL))) AS sheets,
            (SELECT MAX(r.updated_at) FROM records r WHERE r.client_id = c.id) AS last_activity
       FROM clients c
      WHERE c.org_id = ? AND ${scope.sql} ${opts.includeArchived ? "" : "AND c.archived_at IS NULL"}
      ORDER BY c.name COLLATE NOCASE`,
    [actor.orgId, ...scope.params],
  );
  let list = rows.map((r) => ({
    id: r.id,
    name: r.name,
    aliases: json<string[]>(r.aliases, []),
    notes: r.notes,
    spreadsheetCount: r.sheets,
    updatedAt: r.last_activity && r.last_activity > r.updated_at ? r.last_activity : r.updated_at,
  }));
  if (opts.q) {
    const ranked = rankClients(opts.q, list);
    list = ranked.map((x) => x.client);
  }
  return list;
}

export function getClient(core: Core, actor: Actor, id: string): ClientSummary {
  const r = core.db.get<ClientRow>("SELECT * FROM clients WHERE id = ? AND org_id = ?", [id, actor.orgId]);
  if (!r || !canSeeClient(actor, r.id)) throw notFound("Cliente");
  const sheets = core.db.get<{ n: number }>(
    `SELECT COUNT(DISTINCT s.id) n FROM spreadsheets s WHERE s.deleted_at IS NULL AND (s.client_id = ? OR EXISTS (
       SELECT 1 FROM records r WHERE r.spreadsheet_id = s.id AND r.client_id = ? AND r.deleted_at IS NULL))`,
    [id, id],
  )!.n;
  return { id: r.id, name: r.name, aliases: json<string[]>(r.aliases, []), notes: r.notes, spreadsheetCount: sheets, updatedAt: r.updated_at };
}

export function createClient(
  core: Core,
  actor: Actor,
  input: { name: string; aliases?: string[]; notes?: string | null },
  source: AuditSource = "ui",
): ClientSummary {
  require(actor, "manage_clients");
  if (!actor.scopeAll) throw forbidden("Seu acesso é restrito a clientes específicos; peça a um administrador para cadastrar.");
  const name = prettyName(input.name);
  const key = nameKey(name);
  if (!key) throw badRequest("Informe o nome do cliente.");
  const existing = core.db.get<ClientRow>("SELECT * FROM clients WHERE org_id = ? AND name_key = ?", [actor.orgId, key]);
  if (existing) {
    if (existing.archived_at) {
      core.db.run("UPDATE clients SET archived_at = NULL, updated_at = ? WHERE id = ?", [nowIso(), existing.id]);
      return getClient(core, actor, existing.id);
    }
    throw badRequest(`Já existe um cliente chamado "${existing.name}".`, { clientId: existing.id });
  }
  const id = newId("cli");
  const now = nowIso();
  const aliases = (input.aliases ?? []).map((a) => a.trim()).filter(Boolean).slice(0, 20);
  core.db.run("INSERT INTO clients (id, org_id, name, name_key, aliases, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)", [
    id,
    actor.orgId,
    name,
    key,
    JSON.stringify(aliases),
    input.notes?.trim() || null,
    now,
    now,
  ]);
  indexClient(core, { id, orgId: actor.orgId, name, aliases });
  audit(core, actor, { source, action: "client.create", entityType: "client", entityId: id, clientId: id, summary: `Cliente "${name}" cadastrado` });
  return getClient(core, actor, id);
}

export function updateClient(core: Core, actor: Actor, id: string, patch: { name?: string; aliases?: string[]; notes?: string | null; archived?: boolean }) {
  require(actor, "manage_clients");
  const before = core.db.get<ClientRow>("SELECT * FROM clients WHERE id = ? AND org_id = ?", [id, actor.orgId]);
  if (!before || !canSeeClient(actor, id)) throw notFound("Cliente");
  const name = patch.name !== undefined ? prettyName(patch.name) : before.name;
  const key = nameKey(name);
  if (!key) throw badRequest("Informe o nome do cliente.");
  const clash = core.db.get<{ id: string }>("SELECT id FROM clients WHERE org_id = ? AND name_key = ? AND id <> ?", [actor.orgId, key, id]);
  if (clash) throw badRequest("Já existe outro cliente com esse nome.");
  const aliases = patch.aliases ? patch.aliases.map((a) => a.trim()).filter(Boolean).slice(0, 20) : json<string[]>(before.aliases, []);
  const archivedAt = patch.archived === undefined ? before.archived_at : patch.archived ? nowIso() : null;
  core.db.run("UPDATE clients SET name = ?, name_key = ?, aliases = ?, notes = ?, archived_at = ?, updated_at = ? WHERE id = ?", [
    name,
    key,
    JSON.stringify(aliases),
    patch.notes !== undefined ? patch.notes?.trim() || null : before.notes,
    archivedAt,
    nowIso(),
    id,
  ]);
  if (archivedAt) removeFromIndex(core, "client", id);
  else indexClient(core, { id, orgId: actor.orgId, name, aliases });
  audit(core, actor, {
    source: "ui",
    action: patch.archived ? "client.archive" : "client.update",
    entityType: "client",
    entityId: id,
    clientId: id,
    summary: patch.archived ? `Cliente "${before.name}" arquivado` : `Cliente "${name}" atualizado`,
    details: { before: { name: before.name, aliases: json(before.aliases, []), notes: before.notes }, after: { name, aliases, notes: patch.notes } },
  });
  return getClient(core, actor, id);
}

/**
 * Encontra (ou cadastra) o cliente correspondente ao texto de uma célula.
 * Usado quando a coluna "Assistido/Cliente" de uma planilha é preenchida.
 */
export function resolveClientId(core: Core, actor: Actor, raw: unknown, opts: { create: boolean; source: AuditSource }): string | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  const key = nameKey(text);
  if (!key) return null;
  const hit = core.db.get<{ id: string }>("SELECT id FROM clients WHERE org_id = ? AND name_key = ?", [actor.orgId, key]);
  if (hit) return hit.id;
  const all = core.db.all<{ id: string; aliases: string }>("SELECT id, aliases FROM clients WHERE org_id = ? AND aliases <> '[]'", [actor.orgId]);
  for (const c of all) if (json<string[]>(c.aliases, []).some((a) => nameKey(a) === key)) return c.id;
  if (!opts.create || !actor.scopeAll) return null;
  const id = newId("cli");
  const now = nowIso();
  const name = prettyName(text);
  core.db.run("INSERT INTO clients (id, org_id, name, name_key, aliases, created_at, updated_at) VALUES (?,?,?,?, '[]', ?, ?)", [id, actor.orgId, name, key, now, now]);
  indexClient(core, { id, orgId: actor.orgId, name, aliases: [] });
  audit(core, actor, { source: opts.source, action: "client.create", entityType: "client", entityId: id, clientId: id, summary: `Cliente "${name}" cadastrado automaticamente` });
  return id;
}

export interface RankedClient<T> {
  client: T;
  score: number;
}

/**
 * Busca aproximada por nome: tolera acentos, "seu/dona/sr.", erros de digitação
 * e nomes parciais ("dinaldo" encontra "José Dinaldo").
 */
export function rankClients<T extends { name: string; aliases: string[] }>(query: string, clients: T[]): RankedClient<T>[] {
  const qWords = nameKey(query).split(" ").filter((w) => w.length >= 2);
  if (!qWords.length) return [];
  const out: RankedClient<T>[] = [];
  for (const c of clients) {
    let best = 0;
    for (const label of [c.name, ...c.aliases]) {
      const words = nameKey(label).split(" ").filter(Boolean);
      if (!words.length) continue;
      let matched = 0;
      let exact = 0;
      for (const q of qWords) {
        const w = words.find((x) => x === q || wordsMatch(x, q) || (q.length >= 3 && x.startsWith(q)));
        if (w) {
          matched++;
          if (w === q) exact++;
        }
      }
      if (!matched) continue;
      const coverageQ = matched / qWords.length;
      const coverageName = matched / words.length;
      const score = coverageQ * 0.6 + coverageName * 0.3 + (exact / qWords.length) * 0.1 + (normalize(label) === normalize(query) ? 0.2 : 0);
      best = Math.max(best, score);
    }
    if (best >= 0.45) out.push({ client: c, score: Math.round(best * 1000) / 1000 });
  }
  return out.sort((a, b) => b.score - a.score || a.client.name.localeCompare(b.client.name));
}
