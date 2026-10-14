import type { Actor, Core } from "../core.js";
import { MONTHS_PT } from "../../shared/types.js";
import { normalize } from "../../shared/text.js";
import { canSeeClient } from "./access.js";

// Índice de texto completo (FTS5) para a busca global.

export function indexClient(core: Core, c: { id: string; orgId: string; name: string; aliases: string[] }) {
  removeFromIndex(core, "client", c.id);
  core.db.run("INSERT INTO search_index (kind, ref_id, org_id, title, body) VALUES ('client', ?, ?, ?, ?)", [c.id, c.orgId, c.name, c.aliases.join(" ")]);
}

export function indexSpreadsheet(
  core: Core,
  s: { id: string; orgId: string; title: string; category: string; month: number | null; year: number | null; workbook: string | null; clientName: string | null },
) {
  removeFromIndex(core, "spreadsheet", s.id);
  const body = [s.category, s.workbook, s.month ? MONTHS_PT[s.month - 1] : null, s.year, s.clientName].filter(Boolean).join(" ");
  core.db.run("INSERT INTO search_index (kind, ref_id, org_id, title, body) VALUES ('spreadsheet', ?, ?, ?, ?)", [s.id, s.orgId, s.title, body]);
}

export function removeFromIndex(core: Core, kind: "client" | "spreadsheet", id: string) {
  core.db.run("DELETE FROM search_index WHERE kind = ? AND ref_id = ?", [kind, id]);
}

export interface SearchHit {
  kind: "client" | "spreadsheet";
  id: string;
  title: string;
  subtitle: string;
}

export function globalSearch(core: Core, actor: Actor, q: string, limit = 12): SearchHit[] {
  const terms = normalize(q)
    .split(" ")
    .filter((t) => t.length >= 2)
    .slice(0, 8);
  if (!terms.length) return [];
  const match = terms.map((t) => `"${t}"*`).join(" ");
  const rows = core.db.all<{ kind: "client" | "spreadsheet"; ref_id: string; title: string; body: string }>(
    `SELECT kind, ref_id, title, body FROM search_index WHERE search_index MATCH ? AND org_id = ? ORDER BY bm25(search_index, 0, 0, 0, 4, 1) LIMIT 60`,
    [match, actor.orgId],
  );
  const hits: SearchHit[] = [];
  for (const r of rows) {
    if (r.kind === "client") {
      if (!canSeeClient(actor, r.ref_id)) continue;
      hits.push({ kind: "client", id: r.ref_id, title: r.title, subtitle: "Cliente" });
    } else {
      const s = core.db.get<{ client_id: string | null; deleted_at: string | null }>("SELECT client_id, deleted_at FROM spreadsheets WHERE id = ?", [r.ref_id]);
      if (!s || s.deleted_at) continue;
      if (!actor.scopeAll && !canSeeSheetQuick(core, actor, r.ref_id, s.client_id)) continue;
      hits.push({ kind: "spreadsheet", id: r.ref_id, title: r.title, subtitle: r.body });
    }
    if (hits.length >= limit) break;
  }
  return hits;
}

function canSeeSheetQuick(core: Core, actor: Actor, sheetId: string, clientId: string | null): boolean {
  if (clientId && canSeeClient(actor, clientId)) return true;
  const ids = [...actor.clientIds];
  if (!ids.length) return false;
  return !!core.db.get(
    `SELECT 1 FROM records WHERE spreadsheet_id = ? AND deleted_at IS NULL AND client_id IN (${ids.map(() => "?").join(",")}) LIMIT 1`,
    [sheetId, ...ids],
  );
}
