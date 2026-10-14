import type { Actor, Core } from "../core.js";
import type { Column, RowData } from "../../shared/types.js";
import { findRole } from "../../shared/columns.js";
import { computeRow } from "../../shared/formula.js";
import { normalize, sumMoney } from "../../shared/text.js";
import { json } from "../db/db.js";
import { listAudit } from "./audit.js";
import { listClients } from "./clients.js";
import { listSpreadsheets, periodLabel, readRecords, type SheetRow } from "./spreadsheets.js";

export interface PaymentStats {
  period: string;
  month: number;
  year: number;
  total: number;
  rows: number;
  sheets: { id: string; title: string; total: number; rows: number; column: string }[];
}

export interface PendingAlert {
  spreadsheetId: string;
  title: string;
  period: string;
  count: number;
  amount: number | null;
  statusColumn: string;
  values: string[];
}

function amountOf(columns: Column[], data: RowData): number | null {
  const col = findRole(columns, "amount");
  if (!col) return null;
  const v = computeRow(data, columns)[col.id];
  return typeof v === "number" ? v : null;
}

/** Pagamentos do período: soma a coluna marcada como "valor pago" nas planilhas do mês. */
export function paymentStats(core: Core, actor: Actor, month: number, year: number): PaymentStats | null {
  const sheets = core.db.all<SheetRow>("SELECT * FROM spreadsheets WHERE org_id = ? AND deleted_at IS NULL AND year = ? AND month = ?", [actor.orgId, year, month]);
  const out: PaymentStats["sheets"] = [];
  for (const s of sheets) {
    const columns = json<Column[]>(s.columns, []);
    const amount = findRole(columns, "amount");
    if (!amount) continue;
    const status = findRole(columns, "status");
    const paid = new Set((status?.paidValues ?? []).map(normalize));
    const values: number[] = [];
    for (const r of readRecords(core, actor, s)) {
      if (status && paid.size) {
        const st = r.data[status.id];
        if (typeof st !== "string" || !paid.has(normalize(st))) continue;
      }
      const v = amountOf(columns, r.data);
      if (v !== null && v !== 0) values.push(v);
    }
    if (values.length) out.push({ id: s.id, title: s.title, total: sumMoney(values), rows: values.length, column: amount.name });
  }
  if (!out.length) return null;
  return {
    period: periodLabel(month, year),
    month,
    year,
    total: sumMoney(out.map((o) => o.total)),
    rows: out.reduce((n, o) => n + o.rows, 0),
    sheets: out,
  };
}

/** Linhas com situação "pendente" — só quando a coluna de situação está configurada. */
export function pendingAlerts(core: Core, actor: Actor, opts: { clientId?: string; spreadsheetId?: string } = {}): PendingAlert[] {
  const where = ["org_id = ?", "deleted_at IS NULL"];
  const params: string[] = [actor.orgId];
  if (opts.spreadsheetId) {
    where.push("id = ?");
    params.push(opts.spreadsheetId);
  }
  const sheets = core.db.all<SheetRow>(`SELECT * FROM spreadsheets WHERE ${where.join(" AND ")} ORDER BY year DESC, month DESC`, params);
  const out: PendingAlert[] = [];
  for (const s of sheets) {
    const columns = json<Column[]>(s.columns, []);
    const status = findRole(columns, "status");
    if (!status?.pendingValues?.length) continue;
    const pending = new Set(status.pendingValues.map(normalize));
    let count = 0;
    const amounts: number[] = [];
    const records = readRecords(core, actor, s, { clientId: opts.clientId ?? null });
    for (const r of records) {
      if (opts.clientId && s.client_column && r.clientId !== opts.clientId) continue;
      const st = r.data[status.id];
      if (typeof st !== "string" || !pending.has(normalize(st))) continue;
      count++;
      const v = amountOf(columns, r.data);
      if (v !== null) amounts.push(v);
    }
    if (count)
      out.push({
        spreadsheetId: s.id,
        title: s.title,
        period: periodLabel(s.month, s.year),
        count,
        amount: amounts.length ? sumMoney(amounts) : null,
        statusColumn: status.name,
        values: status.pendingValues,
      });
  }
  return out;
}

export function dashboard(core: Core, actor: Actor) {
  const clients = listClients(core, actor);
  const sheets = listSpreadsheets(core, actor, { limit: 1000 });
  const recentSheets = core.db
    .all<{ ref_id: string; viewed_at: string }>("SELECT ref_id, viewed_at FROM recents WHERE user_id = ? AND kind = 'spreadsheet' ORDER BY viewed_at DESC LIMIT 12", [actor.id])
    .map((r) => sheets.find((s) => s.id === r.ref_id))
    .filter(Boolean)
    .slice(0, 6);
  const recentClients = core.db
    .all<{ ref_id: string }>("SELECT ref_id FROM recents WHERE user_id = ? AND kind = 'client' ORDER BY viewed_at DESC LIMIT 12", [actor.id])
    .map((r) => clients.find((c) => c.id === r.ref_id))
    .filter(Boolean)
    .slice(0, 6);

  // Período: mês atual; se não houver dados, o mês mais recente com planilha.
  const now = new Date();
  let payments = paymentStats(core, actor, now.getMonth() + 1, now.getFullYear());
  if (!payments) {
    const latest = core.db.get<{ year: number; month: number }>(
      "SELECT year, month FROM spreadsheets WHERE org_id = ? AND deleted_at IS NULL AND year IS NOT NULL AND month IS NOT NULL ORDER BY year DESC, month DESC LIMIT 1",
      [actor.orgId],
    );
    if (latest) payments = paymentStats(core, actor, latest.month, latest.year);
  }

  return {
    user: { name: actor.name, role: actor.role },
    counts: { clients: clients.length, spreadsheets: sheets.length, records: sheets.reduce((n, s) => n + s.rowCount, 0) },
    recentSheets,
    recentClients,
    activity: listAudit(core, actor, { limit: 8 }),
    payments,
    pending: pendingAlerts(core, actor).slice(0, 6),
    categories: [...new Set(sheets.map((s) => s.category))].sort(),
  };
}
