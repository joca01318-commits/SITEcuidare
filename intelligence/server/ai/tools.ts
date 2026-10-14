// Ferramentas controladas da assistente.
// O modelo de linguagem (ou o motor próprio) nunca acessa o banco diretamente: só pode
// chamar estas funções, que validam parâmetros, checam permissões, limitam os dados
// devolvidos e registram tudo na auditoria. Operações de escrita nunca executam direto:
// geram uma "ação pendente" que o usuário precisa confirmar.

import { z } from "zod";
import type { Actor, Core } from "../core.js";
import type { CellValue, Column, RowData } from "../../shared/types.js";
import { MONTHS_PT } from "../../shared/types.js";
import { coerceValue, findRole, formatCell } from "../../shared/columns.js";
import { FormulaError, type Value } from "../../shared/formula.js";
import { formatDateBR, formatMoney, normalize, sumMoney } from "../../shared/text.js";
import { json } from "../db/db.js";
import { AppError, badRequest, forbidden, newId, notFound, nowIso } from "../lib/util.js";
import { can, canSeeClient } from "../domain/access.js";
import { getClient, listClients, rankClients } from "../domain/clients.js";
import { listAudit } from "../domain/audit.js";
import {
  applyCellOps,
  computeRecords,
  createSpreadsheet,
  deleteRows,
  deleteSpreadsheet,
  describeRow,
  groupTotals,
  insertRows,
  listSpreadsheets,
  listVersions,
  loadSheet,
  periodLabel,
  readRecords,
  restoreVersion,
  totalsFor,
  undeleteRows,
  type ComputedRow,
} from "../domain/spreadsheets.js";

export interface ToolCtx {
  core: Core;
  actor: Actor;
  conversationId: string | null;
  /** true quando o resultado vai para um provedor externo: dados sensíveis são omitidos. */
  external: boolean;
}

// ------------------------------------------------------------------ utilidades

const MAX_ROWS_OUT = 40;

function visibleColumns(ctx: ToolCtx, columns: Column[]): Column[] {
  return columns.filter((c) => !(c.sensitive && (ctx.external || !can(ctx.actor, "view_sensitive"))));
}

function rowOut(ctx: ToolCtx, columns: Column[], row: ComputedRow): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = { id_linha: row.record.id };
  for (const c of visibleColumns(ctx, columns)) {
    const v = row.values[c.id];
    if (v === null || v === undefined || v === "") continue;
    out[c.name] = v instanceof FormulaError ? v.code : (v as string | number | boolean);
  }
  return out;
}

export function columnByNameOrRole(columns: Column[], key: string | undefined | null): Column | undefined {
  if (!key) return undefined;
  const roleAliases: Record<string, Column["role"]> = {
    valor: "amount",
    pagamento: "amount",
    "valor pago": "amount",
    total: "amount",
    cliente: "client",
    assistido: "client",
    cuidador: "worker",
    cuidadora: "worker",
    situacao: "status",
    status: "status",
    data: "payment_date",
    "data do pagamento": "payment_date",
    "data pagamento": "payment_date",
    plantao: "unit_value",
    "valor do plantao": "unit_value",
    "valor plantao": "unit_value",
    quantidade: "quantity",
    plantoes: "quantity",
    faltas: "absences",
    obs: "notes",
    observacao: "notes",
    observacoes: "notes",
    regime: "regime",
    turno: "shift",
  };
  const n = normalize(key);
  const exact = columns.find((c) => normalize(c.name) === n || c.id === key);
  if (exact) return exact;
  const role = roleAliases[n] ?? (columns.some((c) => c.role === key) ? (key as Column["role"]) : undefined);
  if (role) {
    const byRole = findRole(columns, role) ?? (role === "payment_date" ? findRole(columns, "date") : undefined);
    if (byRole) return byRole;
  }
  return columns.find((c) => normalize(c.name).startsWith(n) || n.startsWith(normalize(c.name)));
}

export interface SheetRef {
  id: string;
  title: string;
  category: string;
  month: number | null;
  year: number | null;
  period: string;
  rowCount: number;
  clientName: string | null;
  updatedAt: string;
}

function sheetRef(s: { id: string; title: string; category: string; month: number | null; year: number | null; rowCount: number; clientName: string | null; updatedAt: string }): SheetRef {
  return { id: s.id, title: s.title, category: s.category, month: s.month, year: s.year, period: periodLabel(s.month, s.year), rowCount: s.rowCount, clientName: s.clientName, updatedAt: s.updatedAt };
}

// ------------------------------------------------------------------ leitura

export function searchClients(ctx: ToolCtx, args: { query: string; limit?: number }) {
  const all = listClients(ctx.core, ctx.actor);
  return rankClients(args.query, all)
    .slice(0, Math.min(args.limit ?? 8, 20))
    .map((r) => ({ id: r.client.id, nome: r.client.name, apelidos: r.client.aliases, planilhas: r.client.spreadsheetCount, score: r.score }));
}

export function searchSpreadsheets(ctx: ToolCtx, args: { query?: string; clientId?: string; month?: number; year?: number; category?: string; limit?: number }) {
  if (args.clientId && !canSeeClient(ctx.actor, args.clientId)) throw notFound("Cliente");
  return listSpreadsheets(ctx.core, ctx.actor, {
    q: args.query,
    clientId: args.clientId,
    month: args.month,
    year: args.year,
    category: args.category,
    sort: "period",
    limit: Math.min(args.limit ?? 20, 50),
  }).map(sheetRef);
}

export function getSpreadsheetTool(ctx: ToolCtx, args: { spreadsheetId: string; clientId?: string | null; maxRows?: number }) {
  const { row, columns } = loadSheet(ctx.core, ctx.actor, args.spreadsheetId);
  const recs = readRecords(ctx.core, ctx.actor, row, { clientId: args.clientId ?? null });
  const computed = computeRecords(columns, recs);
  const limit = Math.min(args.maxRows ?? 20, MAX_ROWS_OUT);
  return {
    id: row.id,
    titulo: row.title,
    categoria: row.category,
    periodo: periodLabel(row.month, row.year),
    colunas: visibleColumns(ctx, columns).map((c) => ({ nome: c.name, tipo: c.type, papel: c.role ?? null })),
    total_linhas: computed.length,
    linhas: computed.slice(0, limit).map((r) => rowOut(ctx, columns, r)),
    linhas_omitidas: Math.max(0, computed.length - limit),
    totais: totalsFor(columns, computed).map((t) => ({ coluna: t.name, soma: t.sum, valores: t.count, erros: t.errors })),
  };
}

export interface RecordQuery {
  spreadsheetId?: string;
  clientId?: string;
  month?: number;
  year?: number;
  status?: "pending" | "paid";
  filters?: { column: string; op: "eq" | "contains" | "gt" | "lt" | "empty" | "not_empty"; value?: string | number }[];
  limit?: number;
}

export interface FoundRecord {
  sheet: SheetRef;
  columns: Column[];
  row: ComputedRow;
}

/** Busca linhas em uma ou várias planilhas, aplicando filtros com segurança (sem SQL livre). */
export function findRecords(ctx: ToolCtx, q: RecordQuery): { found: FoundRecord[]; sheets: SheetRef[]; skipped: string[] } {
  const sheets = q.spreadsheetId
    ? [sheetRef({ ...summaryOf(ctx, q.spreadsheetId) })]
    : searchSpreadsheets(ctx, { clientId: q.clientId, month: q.month, year: q.year, limit: 50 });
  const found: FoundRecord[] = [];
  const skipped: string[] = [];
  for (const s of sheets) {
    const { row, columns } = loadSheet(ctx.core, ctx.actor, s.id);
    let statusCol: Column | undefined;
    let wanted: Set<string> | null = null;
    if (q.status) {
      statusCol = findRole(columns, "status");
      const values = q.status === "pending" ? statusCol?.pendingValues : statusCol?.paidValues;
      if (!statusCol || !values?.length) {
        skipped.push(s.title);
        continue;
      }
      wanted = new Set(values.map(normalize));
    }
    const recs = readRecords(ctx.core, ctx.actor, row, { clientId: q.clientId ?? null }).filter(
      (r) => !q.clientId || !row.client_column || r.clientId === q.clientId,
    );
    for (const r of computeRecords(columns, recs)) {
      if (statusCol && wanted) {
        const st = r.values[statusCol.id];
        if (typeof st !== "string" || !wanted.has(normalize(st))) continue;
      }
      if (q.filters?.length && !q.filters.every((f) => matchFilter(columns, r.values, f))) continue;
      found.push({ sheet: s, columns, row: r });
    }
  }
  return { found, sheets, skipped };
}

function summaryOf(ctx: ToolCtx, id: string) {
  const { row } = loadSheet(ctx.core, ctx.actor, id);
  const clientName = row.client_id ? ctx.core.db.get<{ name: string }>("SELECT name FROM clients WHERE id = ?", [row.client_id])?.name ?? null : null;
  const count = ctx.core.db.get<{ n: number }>("SELECT COUNT(*) n FROM records WHERE spreadsheet_id = ? AND deleted_at IS NULL", [id])!.n;
  return { id, title: row.title, category: row.category, month: row.month, year: row.year, rowCount: count, clientName, updatedAt: row.updated_at };
}

function matchFilter(columns: Column[], values: Record<string, Value>, f: NonNullable<RecordQuery["filters"]>[number]): boolean {
  const col = columnByNameOrRole(columns, f.column);
  if (!col) return false;
  const v = values[col.id];
  const empty = v === null || v === undefined || v === "";
  switch (f.op) {
    case "empty":
      return empty;
    case "not_empty":
      return !empty;
    case "eq":
      return !empty && normalize(String(v)) === normalize(String(f.value ?? ""));
    case "contains":
      return !empty && normalize(String(v)).includes(normalize(String(f.value ?? "")));
    case "gt":
      return typeof v === "number" && v > Number(f.value);
    case "lt":
      return typeof v === "number" && v < Number(f.value);
  }
}

export function queryRecords(ctx: ToolCtx, q: RecordQuery) {
  const { found, skipped } = findRecords(ctx, q);
  const limit = Math.min(q.limit ?? 25, MAX_ROWS_OUT);
  return {
    total_encontrado: found.length,
    linhas: found.slice(0, limit).map((f) => ({ planilha: f.sheet.title, id_planilha: f.sheet.id, ...rowOut(ctx, f.columns, f.row) })),
    omitidas: Math.max(0, found.length - limit),
    planilhas_sem_coluna_de_situacao: skipped,
  };
}

export interface TotalsResult {
  total: number;
  count: number;
  status: "pending" | "paid" | "any";
  perSheet: { sheet: SheetRef; column: string; total: number; count: number; errors: number }[];
  sheetsWithoutAmount: string[];
  sheetsWithoutStatus: string[];
  groups?: { key: string; total: number; count: number }[];
}

/** Totais calculados pelo sistema (centavos inteiros), nunca pelo modelo de linguagem. */
export function calculateTotals(ctx: ToolCtx, args: { spreadsheetId?: string; clientId?: string; month?: number; year?: number; column?: string; status?: "pending" | "paid" | "any"; groupBy?: string }): TotalsResult {
  const status = args.status ?? "any";
  const sheets = args.spreadsheetId
    ? [sheetRef(summaryOf(ctx, args.spreadsheetId))]
    : searchSpreadsheets(ctx, { clientId: args.clientId, month: args.month, year: args.year, limit: 50 });
  const perSheet: TotalsResult["perSheet"] = [];
  const withoutAmount: string[] = [];
  const withoutStatus: string[] = [];
  const groupAcc = new Map<string, { values: number[] }>();
  for (const s of sheets) {
    const { row, columns } = loadSheet(ctx.core, ctx.actor, s.id);
    const col = args.column ? columnByNameOrRole(columns, args.column) : findRole(columns, "amount");
    if (!col) {
      withoutAmount.push(s.title);
      continue;
    }
    let wanted: Set<string> | null = null;
    const statusCol = findRole(columns, "status");
    if (status !== "any") {
      const vals = status === "pending" ? statusCol?.pendingValues : statusCol?.paidValues;
      if (!statusCol || !vals?.length) {
        withoutStatus.push(s.title);
        continue;
      }
      wanted = new Set(vals.map(normalize));
    }
    const recs = readRecords(ctx.core, ctx.actor, row, { clientId: args.clientId ?? null }).filter(
      (r) => !args.clientId || !row.client_column || r.clientId === args.clientId,
    );
    let rows = computeRecords(columns, recs);
    if (wanted && statusCol) rows = rows.filter((r) => typeof r.values[statusCol.id] === "string" && wanted!.has(normalize(String(r.values[statusCol.id]))));
    const t = totalsFor([col], rows)[0];
    if (!t) continue;
    perSheet.push({ sheet: s, column: col.name, total: t.sum, count: t.count, errors: t.errors });
    if (args.groupBy) {
      const g = columnByNameOrRole(columns, args.groupBy);
      if (g)
        for (const gr of groupTotals([g, col], rows, g.id)) {
          const acc = groupAcc.get(gr.key) ?? { values: [] };
          const tt = gr.totals.find((x) => x.columnId === col.id);
          if (tt) acc.values.push(tt.sum);
          groupAcc.set(gr.key, acc);
        }
    }
  }
  return {
    total: sumMoney(perSheet.map((p) => p.total)),
    count: perSheet.reduce((n, p) => n + p.count, 0),
    status,
    perSheet,
    sheetsWithoutAmount: withoutAmount,
    sheetsWithoutStatus: withoutStatus,
    groups: args.groupBy ? [...groupAcc.entries()].map(([key, a]) => ({ key, total: sumMoney(a.values), count: a.values.length })) : undefined,
  };
}

export function changeHistory(ctx: ToolCtx, args: { spreadsheetId?: string; clientId?: string; limit?: number }) {
  if (args.spreadsheetId) loadSheet(ctx.core, ctx.actor, args.spreadsheetId);
  if (args.clientId && !canSeeClient(ctx.actor, args.clientId)) throw notFound("Cliente");
  return listAudit(ctx.core, ctx.actor, { spreadsheetId: args.spreadsheetId, clientId: args.clientId, limit: Math.min(args.limit ?? 10, 30) }).map((e) => ({
    quando: e.at,
    quem: e.userName,
    origem: e.source,
    resumo: e.summary,
    planilha: e.spreadsheetTitle,
  }));
}

export function exportLink(ctx: ToolCtx, args: { spreadsheetId: string; format: "pdf" | "xlsx"; clientId?: string | null }) {
  if (!can(ctx.actor, "export")) throw forbidden();
  const { row } = loadSheet(ctx.core, ctx.actor, args.spreadsheetId);
  const qs = new URLSearchParams({ format: args.format });
  if (args.clientId) qs.set("clientId", args.clientId);
  return { titulo: row.title, url: `/api/spreadsheets/${row.id}/export?${qs}` };
}

// ------------------------------------------------------------------ escrita (com confirmação)

export type WriteTool = "add_record" | "update_record" | "delete_record" | "create_spreadsheet" | "restore_previous_version";

export interface Prepared {
  tool: WriteTool;
  args: Record<string, unknown>;
  summary: string;
  changes: { label: string; value: string }[];
  warnings: string[];
}

function fmt(col: Column | undefined, v: CellValue | Value | undefined): string {
  if (v === null || v === undefined || v === "") return "(vazio)";
  return col ? formatCell(col, v as Value) || String(v) : String(v);
}

/** Converte {"Nome da coluna" ou papel: valor} em {id: valor validado}. */
function resolveValues(columns: Column[], values: Record<string, unknown>, year?: number): { data: RowData; changes: Prepared["changes"] } {
  const data: RowData = {};
  const changes: Prepared["changes"] = [];
  for (const [key, raw] of Object.entries(values)) {
    const col = columnByNameOrRole(columns, key);
    if (!col) throw badRequest(`A planilha não tem uma coluna "${key}".`);
    if (col.type === "formula") throw badRequest(`"${col.name}" é calculada automaticamente.`);
    const rawStr = typeof raw === "number" && col.type === "date" ? String(raw) : raw;
    const c = coerceValue(col, rawStr, { year });
    if (!c.ok) throw badRequest(c.error);
    data[col.id] = c.value;
    changes.push({ label: col.name, value: fmt(col, c.value) });
  }
  return { data, changes };
}

export function prepareAddRecord(ctx: ToolCtx, args: { spreadsheetId: string; clientId?: string | null; values: Record<string, unknown> }): Prepared {
  if (!can(ctx.actor, "edit")) throw forbidden("Seu perfil é somente leitura.");
  const { row, columns } = loadSheet(ctx.core, ctx.actor, args.spreadsheetId);
  const { data, changes } = resolveValues(columns, args.values, row.year ?? undefined);
  const warnings: string[] = [];
  let clientName: string | null = null;
  if (args.clientId) {
    const client = getClient(ctx.core, ctx.actor, args.clientId);
    clientName = client.name;
    if (row.client_column && data[row.client_column] === undefined) {
      // Usa o mesmo nome que já aparece nas linhas da planilha (ex.: "DINALDO").
      const existing = ctx.core.db.get<{ v: string | null }>(
        "SELECT json_extract(data, '$.' || ?) AS v FROM records WHERE spreadsheet_id = ? AND client_id = ? AND deleted_at IS NULL LIMIT 1",
        [row.client_column, row.id, args.clientId],
      );
      data[row.client_column] = existing?.v ?? client.name;
      const col = columns.find((c) => c.id === row.client_column)!;
      changes.unshift({ label: col.name, value: String(data[row.client_column]) });
    }
  }
  if (!Object.keys(data).length) throw badRequest("Diga o que deve ser preenchido na nova linha.");
  const amount = findRole(columns, "amount");
  if (amount?.type === "formula" && args.values && Object.keys(args.values).some((k) => columnByNameOrRole(columns, k) === amount))
    warnings.push(`"${amount.name}" é calculada; o valor não pode ser digitado.`);
  return {
    tool: "add_record",
    args: { spreadsheetId: row.id, clientId: args.clientId ?? null, data },
    summary: `Adicionar uma linha em "${row.title}"${clientName ? ` para ${clientName}` : ""}`,
    changes,
    warnings,
  };
}

export function prepareUpdateRecord(ctx: ToolCtx, args: { spreadsheetId: string; recordId: string; values: Record<string, unknown> }): Prepared {
  if (!can(ctx.actor, "edit")) throw forbidden("Seu perfil é somente leitura.");
  const { row, columns } = loadSheet(ctx.core, ctx.actor, args.spreadsheetId);
  const rec = readRecords(ctx.core, ctx.actor, row).find((r) => r.id === args.recordId);
  if (!rec) throw notFound("Linha");
  const { data } = resolveValues(columns, args.values, row.year ?? undefined);
  const ops = Object.entries(data).map(([columnId, value]) => ({ recordId: rec.id, columnId, value, expected: rec.data[columnId] ?? null }));
  const changes = ops.map((op) => {
    const col = columns.find((c) => c.id === op.columnId)!;
    return { label: col.name, value: `${fmt(col, op.expected)} → ${fmt(col, op.value)}` };
  });
  return {
    tool: "update_record",
    args: { spreadsheetId: row.id, ops },
    summary: `Alterar a linha ${describeShort(columns, rec.data)} em "${row.title}"`,
    changes,
    warnings: [],
  };
}

export function prepareDeleteRecord(ctx: ToolCtx, args: { spreadsheetId: string; recordIds: string[] }): Prepared {
  if (!can(ctx.actor, "edit")) throw forbidden("Seu perfil é somente leitura.");
  const { row, columns } = loadSheet(ctx.core, ctx.actor, args.spreadsheetId);
  const recs = readRecords(ctx.core, ctx.actor, row).filter((r) => args.recordIds.includes(r.id));
  if (!recs.length) throw notFound("Linha");
  return {
    tool: "delete_record",
    args: { spreadsheetId: row.id, recordIds: recs.map((r) => r.id) },
    summary: `Excluir ${recs.length === 1 ? "1 linha" : `${recs.length} linhas`} de "${row.title}"`,
    changes: recs.slice(0, 10).map((r, i) => ({ label: `Linha ${i + 1}`, value: describeShort(columns, r.data) })),
    warnings: ["A exclusão pode ser desfeita depois, pelo botão Desfazer ou pelo histórico de versões."],
  };
}

export function retitle(title: string, fromMonth: number | null, toMonth: number, toYear: number | null, fromYear: number | null): string {
  let t = title;
  if (fromMonth) {
    const from = MONTHS_PT[fromMonth - 1];
    const to = MONTHS_PT[toMonth - 1];
    const variants: [string, string][] = [
      [from.toUpperCase(), to.toUpperCase()],
      [from, to],
      [from.toLowerCase(), to.toLowerCase()],
      [normalize(from).toUpperCase(), to.toUpperCase()],
      [normalize(from), to.toLowerCase()],
    ];
    let replaced = false;
    for (const [a, b] of variants)
      if (t.includes(a)) {
        t = t.split(a).join(b);
        replaced = true;
        break;
      }
    if (!replaced) t = `${t} - ${MONTHS_PT[toMonth - 1]}`;
  } else t = `${t} - ${MONTHS_PT[toMonth - 1]}`;
  if (fromYear && toYear && fromYear !== toYear) t = t.split(String(fromYear)).join(String(toYear));
  return t;
}

export function prepareCreateSpreadsheet(
  ctx: ToolCtx,
  args: { templateId?: string; month: number; year: number; title?: string; clientId?: string | null; copy?: "carry" | "all" | "none" },
): Prepared {
  if (!can(ctx.actor, "edit")) throw forbidden("Seu perfil é somente leitura.");
  if (args.month < 1 || args.month > 12) throw badRequest("Mês inválido.");
  const warnings: string[] = [];
  const changes: Prepared["changes"] = [];
  let title = args.title?.trim() ?? "";
  let category: string | undefined;
  if (args.templateId) {
    const { row, columns } = loadSheet(ctx.core, ctx.actor, args.templateId);
    category = row.category;
    if (!title) title = retitle(row.title, row.month, args.month, args.year, row.year);
    const copy = args.copy ?? "carry";
    const recs = readRecords(ctx.core, ctx.actor, row);
    const carry = columns.filter((c) => copy === "all" || (copy === "carry" && c.carryOver));
    const cleared = columns.filter((c) => !carry.includes(c) && c.type !== "formula");
    changes.push({ label: "Modelo", value: `${row.title} (${periodLabel(row.month, row.year) || "sem período"})` });
    changes.push({ label: "Linhas", value: copy === "none" ? "nenhuma (só a estrutura)" : `${recs.length} linhas copiadas` });
    if (copy !== "none" && carry.length) changes.push({ label: "Mantém", value: carry.map((c) => c.name).join(", ") });
    if (copy === "carry" && cleared.length) changes.push({ label: "Começa vazio", value: cleared.map((c) => c.name).join(", ") });
    const dup = ctx.core.db.get<{ title: string }>(
      "SELECT title FROM spreadsheets WHERE org_id = ? AND deleted_at IS NULL AND category = ? AND year = ? AND month = ? LIMIT 1",
      [ctx.actor.orgId, row.category, args.year, args.month],
    );
    if (dup) warnings.push(`Já existe "${dup.title}" para ${periodLabel(args.month, args.year)} na mesma categoria.`);
  } else if (!title) title = `Planilha - ${MONTHS_PT[args.month - 1]} de ${args.year}`;
  changes.unshift({ label: "Nome", value: title }, { label: "Período", value: periodLabel(args.month, args.year) });
  return {
    tool: "create_spreadsheet",
    args: { templateId: args.templateId ?? null, month: args.month, year: args.year, title, clientId: args.clientId ?? null, copy: args.copy ?? "carry", category: category ?? null },
    summary: `Criar a planilha "${title}"`,
    changes,
    warnings,
  };
}

export function prepareRestoreVersion(ctx: ToolCtx, args: { spreadsheetId: string; versionNumber: number }): Prepared {
  if (!can(ctx.actor, "restore")) throw forbidden();
  const { row } = loadSheet(ctx.core, ctx.actor, args.spreadsheetId);
  const v = listVersions(ctx.core, ctx.actor, row.id).find((x) => x.number === args.versionNumber);
  if (!v) throw notFound("Versão");
  return {
    tool: "restore_previous_version",
    args: { spreadsheetId: row.id, versionId: v.id, number: v.number },
    summary: `Restaurar "${row.title}" para a versão ${v.number}`,
    changes: [
      { label: "Versão", value: `${v.number} — ${v.reason}` },
      { label: "De", value: new Date(v.createdAt).toLocaleString("pt-BR") },
      { label: "Linhas", value: String(v.rowCount) },
    ],
    warnings: ["O estado atual será guardado como uma nova versão antes da restauração."],
  };
}

function describeShort(columns: Column[], data: RowData): string {
  const d = describeRow(columns, data);
  const parts = Object.entries(d)
    .filter(([k]) => !columns.find((c) => c.name === k)?.sensitive)
    .slice(0, 4)
    .map(([k, v]) => {
      const col = columns.find((c) => c.name === k);
      return col ? fmt(col, v) : String(v);
    });
  return parts.join(" · ") || "(linha vazia)";
}

// ------------------------------------------------------------------ ações pendentes

export interface PendingRow {
  id: string;
  conversation_id: string | null;
  user_id: string;
  tool: WriteTool;
  args: string;
  summary: string;
  status: "pending" | "done" | "cancelled" | "expired" | "failed" | "undone";
  result: string | null;
  created_at: string;
  expires_at: string;
}

export function savePending(ctx: ToolCtx, p: Prepared): string {
  const id = newId("act");
  ctx.core.db.run(
    "INSERT INTO pending_actions (id, conversation_id, user_id, tool, args, summary, status, created_at, expires_at) VALUES (?,?,?,?,?,?, 'pending', ?, ?)",
    [id, ctx.conversationId, ctx.actor.id, p.tool, JSON.stringify(p.args), p.summary, nowIso(), new Date(Date.now() + 30 * 60_000).toISOString()],
  );
  return id;
}

export interface ExecResult {
  message: string;
  spreadsheetId: string | null;
  clientId: string | null;
  recordIds: string[];
  undo: Record<string, unknown> | null;
}

/** Executa uma ação confirmada pelo usuário. Origem "ai" na auditoria. */
export function executePending(ctx: ToolCtx, pendingId: string): ExecResult {
  const p = ctx.core.db.get<PendingRow>("SELECT * FROM pending_actions WHERE id = ?", [pendingId]);
  if (!p || p.user_id !== ctx.actor.id) throw notFound("Ação");
  if (p.status !== "pending") throw new AppError(409, "not_pending", p.status === "done" ? "Esta ação já foi executada." : "Esta ação não está mais disponível.");
  if (p.expires_at < nowIso()) {
    ctx.core.db.run("UPDATE pending_actions SET status = 'expired', resolved_at = ? WHERE id = ?", [nowIso(), p.id]);
    throw new AppError(410, "expired", "A confirmação expirou. Peça de novo à assistente.");
  }
  const args = json<Record<string, unknown>>(p.args, {});
  let result: ExecResult;
  try {
    result = ctx.core.db.tx(() => run(ctx, p.tool, args, p.summary));
  } catch (e) {
    ctx.core.db.run("UPDATE pending_actions SET status = 'failed', result = ?, resolved_at = ? WHERE id = ?", [JSON.stringify({ error: (e as Error).message }), nowIso(), p.id]);
    throw e;
  }
  ctx.core.db.run("UPDATE pending_actions SET status = 'done', result = ?, resolved_at = ? WHERE id = ?", [JSON.stringify(result), nowIso(), p.id]);
  return result;
}

function run(ctx: ToolCtx, tool: WriteTool, args: Record<string, unknown>, summary: string): ExecResult {
  const { core, actor } = ctx;
  const reason = `Antes da assistente: ${summary}`.slice(0, 190);
  switch (tool) {
    case "add_record": {
      const sheetId = String(args.spreadsheetId);
      const { row } = loadSheet(core, actor, sheetId);
      // Insere logo após a última linha do mesmo cliente, mantendo a planilha agrupada.
      let afterId: string | null = null;
      if (args.clientId && row.client_column) {
        afterId =
          core.db.get<{ id: string }>(
            "SELECT id FROM records WHERE spreadsheet_id = ? AND client_id = ? AND deleted_at IS NULL ORDER BY position DESC LIMIT 1",
            [sheetId, String(args.clientId)],
          )?.id ?? null;
      }
      const r = insertRows(core, actor, sheetId, { afterId, rows: [args.data as RowData], clientId: (args.clientId as string) ?? null }, "ai", { snapshotReason: reason });
      const rec = r.created[0];
      return { message: `Linha adicionada em "${row.title}".`, spreadsheetId: sheetId, clientId: rec.clientId, recordIds: [rec.id], undo: { tool: "delete", sheetId, ids: [rec.id] } };
    }
    case "update_record": {
      const sheetId = String(args.spreadsheetId);
      const ops = args.ops as { recordId: string; columnId: string; value: CellValue; expected: CellValue }[];
      const res = applyCellOps(core, actor, sheetId, ops, "ai", { snapshotReason: reason });
      if (res.conflicts.length)
        throw new AppError(409, "conflict", "Alguém alterou essa linha depois que a assistente leu os dados. Nada foi salvo; peça de novo para ver os valores atuais.");
      const { row } = loadSheet(core, actor, sheetId);
      return {
        message: `Alteração salva em "${row.title}".`,
        spreadsheetId: sheetId,
        clientId: null,
        recordIds: [...new Set(ops.map((o) => o.recordId))],
        undo: { tool: "cells", sheetId, ops: ops.map((o) => ({ recordId: o.recordId, columnId: o.columnId, value: o.expected, expected: o.value })) },
      };
    }
    case "delete_record": {
      const sheetId = String(args.spreadsheetId);
      const ids = args.recordIds as string[];
      deleteRows(core, actor, sheetId, ids, "ai", { snapshotReason: reason });
      return { message: "Linha(s) excluída(s).", spreadsheetId: sheetId, clientId: null, recordIds: [], undo: { tool: "undelete", sheetId, ids } };
    }
    case "create_spreadsheet": {
      const id = createSpreadsheet(
        core,
        actor,
        {
          title: String(args.title),
          month: Number(args.month),
          year: Number(args.year),
          templateId: (args.templateId as string) ?? undefined,
          copyRows: (args.copy as "carry" | "all" | "none") ?? "carry",
          clientId: (args.clientId as string) ?? null,
          category: (args.category as string) ?? undefined,
        },
        "ai",
      );
      return { message: `Planilha "${String(args.title)}" criada.`, spreadsheetId: id, clientId: (args.clientId as string) ?? null, recordIds: [], undo: { tool: "trash", sheetId: id } };
    }
    case "restore_previous_version": {
      const sheetId = String(args.spreadsheetId);
      const r = restoreVersion(core, actor, sheetId, String(args.versionId), "ai");
      const backup = listVersions(core, actor, sheetId).find((v) => v.number === r.backupNumber);
      return {
        message: `Versão ${r.restoredNumber} restaurada. O estado anterior ficou guardado como versão ${r.backupNumber}.`,
        spreadsheetId: sheetId,
        clientId: null,
        recordIds: [],
        undo: backup ? { tool: "restore", sheetId, versionId: backup.id } : null,
      };
    }
  }
}

export function undoPending(ctx: ToolCtx, pendingId: string): string {
  const p = ctx.core.db.get<PendingRow>("SELECT * FROM pending_actions WHERE id = ?", [pendingId]);
  if (!p || p.user_id !== ctx.actor.id) throw notFound("Ação");
  if (p.status !== "done") throw new AppError(409, "not_done", p.status === "undone" ? "Esta ação já foi desfeita." : "Só é possível desfazer ações concluídas.");
  const result = json<ExecResult | null>(p.result, null);
  const undo = result?.undo;
  if (!undo) throw badRequest("Esta ação não pode ser desfeita automaticamente. Use o histórico de versões.");
  const sheetId = String(undo.sheetId);
  ctx.core.db.tx(() => {
    switch (undo.tool) {
      case "delete":
        deleteRows(ctx.core, ctx.actor, sheetId, undo.ids as string[], "ai", { snapshotReason: "Antes de desfazer ação da assistente" });
        break;
      case "undelete":
        undeleteRows(ctx.core, ctx.actor, sheetId, undo.ids as string[], "ai");
        break;
      case "cells": {
        const res = applyCellOps(ctx.core, ctx.actor, sheetId, undo.ops as never, "ai", { snapshotReason: "Antes de desfazer ação da assistente" });
        if (res.conflicts.length) throw new AppError(409, "conflict", "Não deu para desfazer: a linha foi alterada de novo depois. Confira o histórico de versões.");
        break;
      }
      case "trash":
        deleteSpreadsheet(ctx.core, ctx.actor, sheetId, "ai");
        break;
      case "restore":
        restoreVersion(ctx.core, ctx.actor, sheetId, String(undo.versionId), "ai");
        break;
      default:
        throw badRequest("Desfazer não suportado.");
    }
    ctx.core.db.run("UPDATE pending_actions SET status = 'undone', resolved_at = ? WHERE id = ?", [nowIso(), p.id]);
  });
  return `Desfeito: ${p.summary.charAt(0).toLowerCase()}${p.summary.slice(1)}.`;
}

export function cancelPending(ctx: ToolCtx, pendingId: string) {
  const r = ctx.core.db.run("UPDATE pending_actions SET status = 'cancelled', resolved_at = ? WHERE id = ? AND user_id = ? AND status = 'pending'", [nowIso(), pendingId, ctx.actor.id]);
  if (!r.changes) throw notFound("Ação pendente");
}

export function lastDoneAction(ctx: ToolCtx): PendingRow | undefined {
  return ctx.core.db.get<PendingRow>(
    "SELECT * FROM pending_actions WHERE user_id = ? AND status = 'done' AND (conversation_id = ? OR ? IS NULL) ORDER BY resolved_at DESC LIMIT 1",
    [ctx.actor.id, ctx.conversationId, ctx.conversationId],
  );
}

// ------------------------------------------------------------------ catálogo para o modelo de linguagem

const zMonth = z.number().int().min(1).max(12);
const zYear = z.number().int().min(2000).max(2100);

export const TOOL_SCHEMAS = {
  search_clients: z.object({ query: z.string().min(1).max(100).describe("Nome ou parte do nome do cliente/assistido") }),
  search_spreadsheets: z.object({
    query: z.string().max(100).optional(),
    clientId: z.string().max(40).optional(),
    month: zMonth.optional(),
    year: zYear.optional(),
    category: z.string().max(80).optional(),
  }),
  get_spreadsheet: z.object({ spreadsheetId: z.string().max(40), clientId: z.string().max(40).optional(), maxRows: z.number().int().min(1).max(40).optional() }),
  query_records: z.object({
    spreadsheetId: z.string().max(40).optional(),
    clientId: z.string().max(40).optional(),
    month: zMonth.optional(),
    year: zYear.optional(),
    status: z.enum(["pending", "paid"]).optional(),
    filters: z
      .array(z.object({ column: z.string().max(80), op: z.enum(["eq", "contains", "gt", "lt", "empty", "not_empty"]), value: z.union([z.string().max(200), z.number()]).optional() }))
      .max(5)
      .optional(),
    limit: z.number().int().min(1).max(40).optional(),
  }),
  calculate_totals: z.object({
    spreadsheetId: z.string().max(40).optional(),
    clientId: z.string().max(40).optional(),
    month: zMonth.optional(),
    year: zYear.optional(),
    column: z.string().max(80).optional().describe("Nome da coluna a somar; se omitido, usa a coluna marcada como valor pago"),
    status: z.enum(["pending", "paid", "any"]).optional(),
    groupBy: z.string().max(80).optional(),
  }),
  create_spreadsheet: z.object({
    month: zMonth,
    year: zYear,
    templateSpreadsheetId: z.string().max(40).optional(),
    title: z.string().max(200).optional(),
    clientId: z.string().max(40).optional(),
    copy: z.enum(["carry", "all", "none"]).optional(),
  }),
  add_record: z.object({
    spreadsheetId: z.string().max(40),
    clientId: z.string().max(40).optional(),
    values: z.record(z.string().max(80), z.union([z.string().max(500), z.number(), z.boolean(), z.null()])).describe('Ex.: {"valor": 350, "data": "12/10/2026", "cuidador": "Suzana"}'),
  }),
  update_record: z.object({
    spreadsheetId: z.string().max(40),
    recordId: z.string().max(40),
    values: z.record(z.string().max(80), z.union([z.string().max(500), z.number(), z.boolean(), z.null()])),
  }),
  delete_record: z.object({ spreadsheetId: z.string().max(40), recordIds: z.array(z.string().max(40)).min(1).max(20) }),
  export_spreadsheet: z.object({ spreadsheetId: z.string().max(40), format: z.enum(["pdf", "xlsx"]), clientId: z.string().max(40).optional() }),
  get_change_history: z.object({ spreadsheetId: z.string().max(40).optional(), clientId: z.string().max(40).optional(), limit: z.number().int().min(1).max(30).optional() }),
  restore_previous_version: z.object({ spreadsheetId: z.string().max(40), versionNumber: z.number().int().min(1).optional() }),
} as const;

export type ToolName = keyof typeof TOOL_SCHEMAS;

export const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  search_clients: "Procura clientes/assistidos pelo nome (tolera apelidos, acentos e erros de digitação).",
  search_spreadsheets: "Lista planilhas, filtrando por cliente, mês, ano, categoria ou texto.",
  get_spreadsheet: "Lê a estrutura e as primeiras linhas de uma planilha (opcionalmente só as linhas de um cliente).",
  query_records: "Busca linhas em uma ou várias planilhas com filtros (situação pendente/paga, coluna = valor, etc.).",
  calculate_totals: "Soma valores com precisão de centavos. Sempre use esta ferramenta para totais; nunca calcule de cabeça.",
  create_spreadsheet: "Propõe criar uma planilha (opcionalmente copiando outra como modelo). Exige confirmação do usuário.",
  add_record: "Propõe adicionar uma linha. Exige confirmação do usuário.",
  update_record: "Propõe alterar valores de uma linha existente. Exige confirmação do usuário.",
  delete_record: "Propõe excluir linhas. Exige confirmação do usuário.",
  export_spreadsheet: "Gera um link para baixar a planilha em PDF ou Excel.",
  get_change_history: "Mostra o histórico de alterações de uma planilha ou cliente.",
  restore_previous_version: "Lista versões ou propõe restaurar uma versão anterior. Exige confirmação do usuário.",
};

export function toolJsonSchemas() {
  return (Object.keys(TOOL_SCHEMAS) as ToolName[]).map((name) => ({
    type: "function" as const,
    function: { name, description: TOOL_DESCRIPTIONS[name], parameters: z.toJSONSchema(TOOL_SCHEMAS[name]) },
  }));
}

export function monthName(m: number) {
  return MONTHS_PT[m - 1];
}

export { formatMoney, formatDateBR };
