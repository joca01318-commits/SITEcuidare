// Motor próprio da assistente: entende os pedidos mais comuns em português usando
// regras determinísticas e executa tudo pelas ferramentas controladas (tools.ts).
// Custo zero, funciona offline e nenhum dado sai do servidor.

import type { AssistantAction, AssistantMessage, ClientSummary, Column } from "../../shared/types.js";
import { MONTHS_PT } from "../../shared/types.js";
import { findRole, formatCell } from "../../shared/columns.js";
import { FormulaError, type Value } from "../../shared/formula.js";
import { formatDateBR, formatMoney, makeIsoDate, normalize, parseNumberBR, sumMoney } from "../../shared/text.js";
import { AppError } from "../lib/util.js";
import { listClients } from "../domain/clients.js";
import { listVersions, periodLabel, type ComputedRow } from "../domain/spreadsheets.js";
import { findMentions, parse, pickClear, type Parsed } from "./nlu.js";
import {
  calculateTotals,
  changeHistory,
  columnByNameOrRole,
  exportLink,
  findRecords,
  lastDoneAction,
  prepareAddRecord,
  prepareCreateSpreadsheet,
  prepareDeleteRecord,
  prepareRestoreVersion,
  prepareUpdateRecord,
  savePending,
  searchSpreadsheets,
  undoPending,
  type FoundRecord,
  type Prepared,
  type SheetRef,
  type ToolCtx,
} from "./tools.js";

export interface ConvState {
  clientId?: string | null;
  spreadsheetId?: string | null;
  recordIds?: string[];
  pendingId?: string | null;
  choice?: { kind: "client" | "spreadsheet" | "record"; options: { id: string; label: string; sheetId?: string }[]; text: string } | null;
  awaiting?: { text: string; need: "client" } | null;
}

export interface PageContext {
  spreadsheetId?: string | null;
  clientId?: string | null;
}

export interface Reply {
  content: string;
  actions?: AssistantAction[];
  table?: AssistantMessage["table"];
  pending?: AssistantMessage["pending"];
  state: ConvState;
  handled: boolean;
}

interface Forced {
  clientId?: string;
  spreadsheetId?: string;
  recordId?: string;
}

const SUGGESTIONS = [
  "Abra a planilha de outubro do seu Dinaldo",
  "Quanto esse cliente pagou este ano?",
  "Mostre os pagamentos pendentes",
  "Some os pagamentos recebidos neste mês",
  "Crie a planilha de novembro com base na de outubro",
];

// ------------------------------------------------------------------ utilidades

function suggest(...texts: string[]): AssistantAction[] {
  return texts.map((t) => ({ kind: "suggest", text: t }));
}

function openAction(s: { id: string; title: string }, clientId?: string | null, label?: string): AssistantAction {
  return { kind: "open_spreadsheet", spreadsheetId: s.id, clientId: clientId ?? null, label: label ?? `Abrir ${s.title}` };
}

function clientName(clients: ClientSummary[], id: string | null | undefined) {
  return clients.find((c) => c.id === id)?.name ?? null;
}

function rowLabel(columns: Column[], row: ComputedRow, skipClient = false): string {
  const pick = (role: NonNullable<Column["role"]>) => {
    const c = findRole(columns, role);
    if (!c) return null;
    const v = row.values[c.id];
    if (v === null || v === undefined || v === "") return null;
    return formatCell(c, v as Value);
  };
  const parts = [skipClient ? null : pick("client"), pick("worker"), pick("amount") ?? pick("unit_value"), pick("payment_date") ?? pick("date"), pick("status")].filter(Boolean);
  if (parts.length >= 2) return parts.join(" · ");
  // Sem papéis configurados: primeiras colunas preenchidas.
  return (
    columns
      .filter((c) => !c.sensitive)
      .map((c) => formatCell(c, row.values[c.id] as Value))
      .filter(Boolean)
      .slice(0, 4)
      .join(" · ") || "(linha vazia)"
  );
}

function pendingReply(ctx: ToolCtx, p: Prepared, state: ConvState, intro?: string): Reply {
  const id = savePending(ctx, p);
  const lines = [intro ?? `${p.summary}.`, ...p.warnings.map((w) => `⚠️ ${w}`), "Confirma?"];
  return {
    content: lines.join("\n"),
    pending: { id, status: "pending", summary: p.summary, changes: p.changes },
    actions: [
      { kind: "confirm", pendingId: id, label: "Confirmar" },
      { kind: "cancel", pendingId: id, label: "Cancelar" },
    ],
    state: { ...state, pendingId: id, choice: null, awaiting: null },
    handled: true,
  };
}

function errorReply(e: unknown, state: ConvState): Reply {
  const msg = e instanceof AppError ? e.message : "Não consegui concluir esse pedido por um erro interno. Nada foi alterado.";
  return { content: msg, state, handled: true };
}

// ------------------------------------------------------------------ resolução de cliente e planilha

type ClientResolution = { client: ClientSummary | null; ambiguous: ClientSummary[]; mentioned: boolean; unknownName: boolean };

function resolveClient(ctx: ToolCtx, p: Parsed, state: ConvState, page: PageContext, forced: Forced, opts: { useContext: boolean }): ClientResolution {
  const clients = listClients(ctx.core, ctx.actor);
  if (forced.clientId) return { client: clients.find((c) => c.id === forced.clientId) ?? null, ambiguous: [], mentioned: true, unknownName: false };
  const cands = findMentions(p.text, clients, (c) => [c.name, ...c.aliases]);
  const { clear, ambiguous } = pickClear(cands);
  if (clear) return { client: clear, ambiguous: [], mentioned: true, unknownName: false };
  if (ambiguous.length) return { client: null, ambiguous, mentioned: true, unknownName: false };
  const named = /\b(do|da|de) (seu|sr|senhor|dona|sra|senhora|cliente|assistido|assistida)\b/.test(p.norm);
  if (p.refersToContextClient || opts.useContext) {
    const id = (p.refersToContextClient ? state.clientId ?? page.clientId : page.clientId ?? state.clientId) ?? null;
    const c = clients.find((x) => x.id === id) ?? null;
    if (c) return { client: c, ambiguous: [], mentioned: false, unknownName: false };
  }
  return { client: null, ambiguous: [], mentioned: false, unknownName: named };
}

function askClient(clients: ClientSummary[], state: ConvState, text: string): Reply {
  return {
    content: "Encontrei mais de um cliente com esse nome. Qual deles?",
    actions: clients.map((c, i) => ({ kind: "suggest", text: `${i + 1}. ${c.name}` }) as AssistantAction),
    state: { ...state, choice: { kind: "client", options: clients.map((c) => ({ id: c.id, label: c.name })), text } },
    handled: true,
  };
}

/** Planilhas do cliente/período. Sem ano, tenta o ano atual e depois o mais recente. */
function sheetsFor(ctx: ToolCtx, clientId: string | null, month: number | null, year: number | null): SheetRef[] {
  if (month && !year) {
    const now = new Date().getFullYear();
    const cur = searchSpreadsheets(ctx, { clientId: clientId ?? undefined, month, year: now });
    if (cur.length) return cur;
    const any = searchSpreadsheets(ctx, { clientId: clientId ?? undefined, month });
    const latest = Math.max(...any.map((s) => s.year ?? 0));
    return any.filter((s) => (s.year ?? 0) === latest);
  }
  return searchSpreadsheets(ctx, { clientId: clientId ?? undefined, month: month ?? undefined, year: year ?? undefined, limit: 50 });
}

function hasAmountColumn(ctx: ToolCtx, sheetId: string): boolean {
  const row = ctx.core.db.get<{ columns: string }>("SELECT columns FROM spreadsheets WHERE id = ?", [sheetId]);
  const cols = row ? (JSON.parse(row.columns) as Column[]) : [];
  return !!findRole(cols, "amount");
}

function sheetColumns(ctx: ToolCtx, sheetId: string): { columns: Column[]; clientColumn: string | null; month: number | null; year: number | null; title: string } {
  const row = ctx.core.db.get<{ columns: string; client_column: string | null; month: number | null; year: number | null; title: string }>(
    "SELECT columns, client_column, month, year, title FROM spreadsheets WHERE id = ?",
    [sheetId],
  )!;
  return { columns: JSON.parse(row.columns) as Column[], clientColumn: row.client_column, month: row.month, year: row.year, title: row.title };
}

function periodText(p: Parsed): string {
  if (p.month) return `${MONTHS_PT[p.month - 1].toLowerCase()}${p.year ? ` de ${p.year}` : ""}`;
  if (p.year) return String(p.year);
  return "";
}

function chooseSheetReply(sheets: SheetRef[], state: ConvState, text: string, question: string, clientId?: string | null): Reply {
  const opts = sheets.slice(0, 8);
  return {
    content: question,
    table: { columns: ["#", "Planilha", "Período", "Linhas"], rows: opts.map((s, i) => [i + 1, s.title, s.period || "—", s.rowCount]) },
    actions: opts.map((s, i) => openAction(s, clientId, `${i + 1}. ${s.title}`)),
    state: { ...state, choice: { kind: "spreadsheet", options: opts.map((s) => ({ id: s.id, label: s.title })), text } },
    handled: true,
  };
}

/** Planilha alvo para escrever/consultar: contexto da tela, conversa ou cliente+período. */
function targetSheet(
  ctx: ToolCtx,
  p: Parsed,
  state: ConvState,
  page: PageContext,
  forced: Forced,
  client: ClientSummary | null,
  opts: { preferAmount?: boolean; month?: number | null; year?: number | null } = {},
): { sheet: SheetRef | null; options: SheetRef[] } {
  if (forced.spreadsheetId) return { sheet: searchById(ctx, forced.spreadsheetId), options: [] };
  const month = opts.month ?? p.month;
  const year = opts.year ?? p.year;
  const ctxSheetId = page.spreadsheetId ?? state.spreadsheetId ?? null;
  if (ctxSheetId && (p.refersToContextSheet || !month)) {
    const s = searchById(ctx, ctxSheetId);
    if (s && (!client || p.refersToContextSheet || sheetHasClient(ctx, s.id, client.id))) return { sheet: s, options: [] };
  }
  let sheets = sheetsFor(ctx, client?.id ?? null, month ?? null, year ?? null);
  if (opts.preferAmount && sheets.length > 1) {
    const withAmount = sheets.filter((s) => hasAmountColumn(ctx, s.id));
    if (withAmount.length) sheets = withAmount;
  }
  if (sheets.length === 1) return { sheet: sheets[0], options: [] };
  return { sheet: null, options: sheets };
}

function searchById(ctx: ToolCtx, id: string): SheetRef | null {
  try {
    return searchSpreadsheets(ctx, { limit: 50 }).find((s) => s.id === id) ?? findAnySheet(ctx, id);
  } catch {
    return null;
  }
}

function findAnySheet(ctx: ToolCtx, id: string): SheetRef | null {
  const row = ctx.core.db.get<{ id: string; title: string; category: string; month: number | null; year: number | null; updated_at: string; deleted_at: string | null }>(
    "SELECT id, title, category, month, year, updated_at, deleted_at FROM spreadsheets WHERE id = ? AND org_id = ?",
    [id, ctx.actor.orgId],
  );
  if (!row || row.deleted_at) return null;
  return { id: row.id, title: row.title, category: row.category, month: row.month, year: row.year, period: periodLabel(row.month, row.year), rowCount: 0, clientName: null, updatedAt: row.updated_at };
}

function sheetHasClient(ctx: ToolCtx, sheetId: string, clientId: string): boolean {
  return !!ctx.core.db.get(
    "SELECT 1 FROM spreadsheets s WHERE s.id = ? AND (s.client_id = ? OR EXISTS (SELECT 1 FROM records r WHERE r.spreadsheet_id = s.id AND r.client_id = ? AND r.deleted_at IS NULL))",
    [sheetId, clientId, clientId],
  );
}

// ------------------------------------------------------------------ intenções

function help(state: ConvState): Reply {
  return {
    content:
      "Posso encontrar e abrir planilhas, somar valores, listar pagamentos pendentes, adicionar ou corrigir lançamentos, criar a planilha do mês seguinte, exportar em PDF/Excel e desfazer alterações.\n" +
      "Toda alteração é mostrada antes para você confirmar, e fica registrada no histórico.",
    actions: suggest(...SUGGESTIONS),
    state,
    handled: true,
  };
}

function open(ctx: ToolCtx, p: Parsed, state: ConvState, page: PageContext, forced: Forced): Reply {
  const r = resolveClient(ctx, p, state, page, forced, { useContext: false });
  if (r.ambiguous.length) return askClient(r.ambiguous, state, p.text);
  if (r.unknownName && !r.client) return { content: "Não encontrei esse cliente. Confira o nome ou veja a lista em Clientes.", state, handled: true, actions: suggest("Quais clientes estão cadastrados?") };
  const client = r.client;
  if (!p.month && !p.year && client && !forced.spreadsheetId) return listSheets(ctx, p, state, client);
  const { sheet, options } = targetSheet(ctx, p, { ...state, spreadsheetId: null }, { spreadsheetId: p.refersToContextSheet ? page.spreadsheetId : null }, forced, client);
  const who = client ? ` de ${client.name}` : "";
  if (sheet) {
    const rows = client ? countClientRows(ctx, sheet.id, client.id) : sheet.rowCount;
    return {
      content: `Encontrei a planilha **${sheet.title}**${sheet.period ? ` (${sheet.period})` : ""}${client ? ` com ${rows} linha(s) de ${client.name}` : ""}. Deseja abri-la?`,
      actions: [openAction(sheet, client?.id, "Abrir planilha")],
      state: { ...state, spreadsheetId: sheet.id, clientId: client?.id ?? state.clientId ?? null, choice: null, awaiting: null },
      handled: true,
    };
  }
  if (options.length) return chooseSheetReply(options, { ...state, clientId: client?.id ?? state.clientId }, p.text, `Encontrei ${options.length} planilhas${who}${p.month ? ` em ${periodText(p)}` : ""}. Qual delas?`, client?.id);
  if (client) {
    const all = sheetsFor(ctx, client.id, null, null);
    return {
      content: `Não encontrei planilha${who}${p.month ? ` em ${periodText(p)}` : ""}.${all.length ? ` Tenho ${all.length} planilha(s) desse cliente:` : ""}`,
      table: all.length ? { columns: ["Planilha", "Período"], rows: all.slice(0, 10).map((s) => [s.title, s.period || "—"]) } : undefined,
      actions: all.slice(0, 4).map((s) => openAction(s, client.id)),
      state: { ...state, clientId: client.id },
      handled: true,
    };
  }
  if (!p.month && !p.year) return help(state);
  return { content: `Não encontrei planilhas de ${periodText(p)}.`, state, handled: true, actions: suggest("Liste todas as planilhas") };
}

function countClientRows(ctx: ToolCtx, sheetId: string, clientId: string): number {
  return ctx.core.db.get<{ n: number }>("SELECT COUNT(*) n FROM records WHERE spreadsheet_id = ? AND client_id = ? AND deleted_at IS NULL", [sheetId, clientId])!.n;
}

function listSheets(ctx: ToolCtx, p: Parsed, state: ConvState, client: ClientSummary | null): Reply {
  const sheets = sheetsFor(ctx, client?.id ?? null, p.month, p.year);
  const who = client ? ` de ${client.name}` : "";
  if (!sheets.length) return { content: `Não encontrei planilhas${who}${p.month || p.year ? ` em ${periodText(p)}` : ""}.`, state, handled: true };
  return {
    content: `Encontrei ${sheets.length} planilha(s)${who}${p.month || p.year ? ` em ${periodText(p)}` : ""}:`,
    table: {
      columns: ["#", "Planilha", "Período", client ? "Linhas do cliente" : "Linhas"],
      rows: sheets.slice(0, 20).map((s, i) => [i + 1, s.title, s.period || "—", s.rowCount]),
    },
    actions: sheets.slice(0, 6).map((s, i) => openAction(s, client?.id, `${i + 1}. ${s.title}`)),
    state: { ...state, clientId: client?.id ?? state.clientId ?? null, choice: { kind: "spreadsheet", options: sheets.slice(0, 20).map((s) => ({ id: s.id, label: s.title })), text: p.text } },
    handled: true,
  };
}

function find(ctx: ToolCtx, p: Parsed, state: ConvState, page: PageContext, forced: Forced): Reply {
  const r = resolveClient(ctx, p, state, page, forced, { useContext: false });
  if (r.ambiguous.length) return askClient(r.ambiguous, state, p.text);
  if (!r.client && /\b(cliente|assistido|determinad[oa]|especific[oa])\b/.test(p.norm) && !p.month && !p.year)
    return { content: "De qual cliente? Diga o nome (por exemplo: “Dinaldo”).", state: { ...state, awaiting: { text: p.text, need: "client" } }, handled: true };
  if (r.unknownName && !r.client) return { content: "Não encontrei esse cliente. Confira o nome em Clientes.", state, handled: true };
  return listSheets(ctx, p, state, r.client);
}

function clientsList(ctx: ToolCtx, state: ConvState): Reply {
  const clients = listClients(ctx.core, ctx.actor);
  if (!clients.length) return { content: "Ainda não há clientes cadastrados. Eles são criados ao importar uma planilha ou em Clientes → Novo cliente.", state, handled: true };
  return {
    content: `Há ${clients.length} cliente(s) cadastrado(s)${clients.length > 30 ? "; mostrando os 30 primeiros" : ""}:`,
    table: { columns: ["Cliente", "Planilhas"], rows: clients.slice(0, 30).map((c) => [c.name, c.spreadsheetCount]) },
    actions: clients.slice(0, 6).map((c) => ({ kind: "open_client", clientId: c.id, label: c.name }) as AssistantAction),
    state,
    handled: true,
  };
}

function totals(ctx: ToolCtx, p: Parsed, state: ConvState, page: PageContext, forced: Forced): Reply {
  const r = resolveClient(ctx, p, state, page, forced, { useContext: false });
  if (r.ambiguous.length) return askClient(r.ambiguous, state, p.text);
  if (r.unknownName && !r.client) return { content: "Não encontrei esse cliente. Confira o nome em Clientes.", state, handled: true };
  const client = r.client;
  const status = p.wantsPending ? "pending" : p.wantsPaid ? "paid" : "any";
  let spreadsheetId: string | undefined;
  let month = p.month;
  let year = p.year;
  let assumed = "";
  if (p.refersToContextSheet && (page.spreadsheetId || state.spreadsheetId)) spreadsheetId = (page.spreadsheetId ?? state.spreadsheetId)!;
  else if (!month && !year && !client) {
    const now = new Date();
    month = now.getMonth() + 1;
    year = now.getFullYear();
    assumed = " (considerei o mês atual)";
  }
  if (month && !year && !spreadsheetId) {
    const s = sheetsFor(ctx, client?.id ?? null, month, null);
    year = s[0]?.year ?? new Date().getFullYear();
  }
  const groupWord = p.norm.match(/\bpor (cuidador\w*|regime|turno|cliente|assistido|situacao|status)\b/)?.[1];
  const res = calculateTotals(ctx, { spreadsheetId, clientId: client?.id, month: month ?? undefined, year: year ?? undefined, status, groupBy: groupWord });
  const scope = [client ? `de ${client.name}` : "", spreadsheetId ? "nesta planilha" : month ? `em ${MONTHS_PT[month - 1].toLowerCase()} de ${year}` : year ? `em ${year}` : ""]
    .filter(Boolean)
    .join(" ");
  const statusTxt = status === "paid" ? " pagos" : status === "pending" ? " pendentes" : "";
  const newState: ConvState = { ...state, clientId: client?.id ?? state.clientId ?? null, choice: null, awaiting: null };
  if (!res.perSheet.length) {
    const why: string[] = [];
    if (res.sheetsWithoutAmount.length) why.push(`${res.sheetsWithoutAmount.length} planilha(s) não têm uma coluna marcada como “valor pago”`);
    if (res.sheetsWithoutStatus.length) why.push(`${res.sheetsWithoutStatus.length} planilha(s) não têm a coluna de situação configurada`);
    return {
      content: `Não encontrei lançamentos${statusTxt} ${scope}${assumed}.${why.length ? ` Observação: ${why.join("; ")}. Você pode configurar isso no cabeçalho da coluna, em “Papel da coluna”.` : ""}`,
      state: newState,
      handled: true,
    };
  }
  const cols = [...new Set(res.perSheet.map((s) => s.column))];
  const errors = res.perSheet.reduce((n, s) => n + s.errors, 0);
  const notes: string[] = [];
  notes.push(`Somei a coluna ${cols.map((c) => `“${c}”`).join(" / ")}${res.perSheet.length > 1 ? ` em ${res.perSheet.length} planilhas` : ""}.`);
  if (status === "paid") notes.push("Contei apenas as linhas com situação de pago (ex.: PAGO).");
  if (status === "pending") notes.push("Contei apenas as linhas com situação pendente (ex.: PENDENTE/PARCIAL).");
  if (errors) notes.push(`${errors} célula(s) com erro de fórmula ficaram de fora.`);
  if (res.sheetsWithoutStatus.length && status !== "any") notes.push(`Sem coluna de situação configurada (ignoradas): ${res.sheetsWithoutStatus.join(", ")}.`);
  const table = res.groups?.length
    ? { columns: [groupWord ?? "Grupo", "Lançamentos", "Total"], rows: res.groups.map((g) => [g.key, g.count, formatMoney(g.total)]), footer: ["Total", res.count, formatMoney(res.total)] }
    : res.perSheet.length > 1
      ? {
          columns: ["Planilha", "Período", "Lançamentos", "Total"],
          rows: res.perSheet.map((s) => [s.sheet.title, s.sheet.period || "—", s.count, formatMoney(s.total)]),
          footer: ["Total", "", res.count, formatMoney(res.total)],
        }
      : undefined;
  return {
    content: `**${formatMoney(res.total)}** em ${res.count} lançamento(s)${statusTxt} ${scope}${assumed}.\n${notes.join(" ")}`,
    table,
    actions: res.perSheet.slice(0, 3).map((s) => openAction(s.sheet, client?.id)),
    state: newState,
    handled: true,
  };
}

function pending(ctx: ToolCtx, p: Parsed, state: ConvState, page: PageContext, forced: Forced): Reply {
  const r = resolveClient(ctx, p, state, page, forced, { useContext: false });
  if (r.ambiguous.length) return askClient(r.ambiguous, state, p.text);
  const client = r.client;
  const spreadsheetId = p.refersToContextSheet ? page.spreadsheetId ?? state.spreadsheetId ?? undefined : undefined;
  const { found, sheets, skipped } = findRecords(ctx, { clientId: client?.id, month: p.month ?? undefined, year: p.year ?? undefined, spreadsheetId: spreadsheetId ?? undefined, status: "pending" });
  const who = client ? ` de ${client.name}` : "";
  const newState = { ...state, clientId: client?.id ?? state.clientId ?? null };
  if (!found.length) {
    if (sheets.length && skipped.length === sheets.length)
      return {
        content: "Nenhuma das planilhas tem uma coluna de situação configurada (com valores como PENDENTE e PAGO), então não consigo saber o que está pendente. Configure em: cabeçalho da coluna → Papel → “Situação do pagamento”.",
        state: newState,
        handled: true,
      };
    return { content: `Não há pagamentos pendentes${who}${p.month || p.year ? ` em ${periodText(p)}` : ""}. 🎉`, state: newState, handled: true };
  }
  const amounts: number[] = [];
  const rows = found.slice(0, 15).map((f) => {
    const amt = findRole(f.columns, "amount");
    const st = findRole(f.columns, "status");
    const cl = findRole(f.columns, "client");
    const wk = findRole(f.columns, "worker");
    const val = amt ? f.row.values[amt.id] : null;
    return [
      f.sheet.title,
      cl ? String(f.row.values[cl.id] ?? "") : f.sheet.clientName ?? "",
      wk ? String(f.row.values[wk.id] ?? "") : "",
      typeof val === "number" ? formatMoney(val) : "",
      st ? String(f.row.values[st.id] ?? "") : "",
    ] as (string | number | null)[];
  });
  for (const f of found) {
    const amt = findRole(f.columns, "amount");
    const v = amt ? f.row.values[amt.id] : null;
    if (typeof v === "number") amounts.push(v);
  }
  const bySheet = new Map<string, SheetRef>();
  for (const f of found) bySheet.set(f.sheet.id, f.sheet);
  return {
    content:
      `Encontrei **${found.length}** lançamento(s) pendente(s)${who}${p.month || p.year ? ` em ${periodText(p)}` : ""}` +
      (amounts.length ? `, somando ${formatMoney(sumMoney(amounts))}` : "") +
      `.${found.length > 15 ? " Mostrando os 15 primeiros." : ""}\n` +
      (/atrasad|vencid/.test(p.norm) ? "As planilhas não têm data de vencimento, então considerei como atrasado o que está marcado como pendente ou parcial." : ""),
    table: { columns: ["Planilha", "Cliente", "Cuidador(a)", "Valor", "Situação"], rows },
    actions: [...bySheet.values()].slice(0, 3).map((s) => openAction(s, client?.id)),
    state: { ...newState, recordIds: found.length === 1 ? [found[0].row.record.id] : state.recordIds, spreadsheetId: bySheet.size === 1 ? [...bySheet.keys()][0] : state.spreadsheetId },
    handled: true,
  };
}

/** Linhas candidatas para alterar/excluir, filtradas por cliente, cuidador, data e valor citados. */
function candidateRecords(ctx: ToolCtx, p: Parsed, sheet: SheetRef, client: ClientSummary | null, oldAmount: number | null): FoundRecord[] {
  const { found } = findRecords(ctx, { spreadsheetId: sheet.id, clientId: client?.id });
  let list = found;
  const cols = found[0]?.columns ?? sheetColumns(ctx, sheet.id).columns;
  const worker = findRole(cols, "worker");
  if (worker) {
    const names = [...new Set(found.map((f) => f.row.values[worker.id]).filter((v): v is string => typeof v === "string" && !!v.trim()))];
    const m = pickClear(findMentions(p.text, names, (n) => [n]));
    const target = m.clear ?? null;
    if (target) list = list.filter((f) => f.row.values[worker.id] === target);
  }
  const dateCol = findRole(cols, "payment_date") ?? findRole(cols, "date");
  if (dateCol && p.day) {
    const byDay = list.filter((f) => {
      const v = f.row.values[dateCol.id];
      return typeof v === "string" && Number(v.slice(8, 10)) === p.day && (!p.month || Number(v.slice(5, 7)) === p.month);
    });
    if (byDay.length) list = byDay;
  }
  const amount = findRole(cols, "amount");
  if (amount && oldAmount !== null) {
    const byAmt = list.filter((f) => typeof f.row.values[amount.id] === "number" && Math.abs((f.row.values[amount.id] as number) - oldAmount) < 0.005);
    if (byAmt.length) list = byAmt;
  }
  // Para valores, ignora linhas totalmente sem valor/data quando há alternativas.
  if (amount && list.length > 1) {
    const filled = list.filter((f) => f.row.values[amount.id] !== null && f.row.values[amount.id] !== undefined);
    if (filled.length) list = filled;
  }
  return list;
}

function chooseRecordReply(cands: FoundRecord[], state: ConvState, text: string, question: string, skipClient: boolean): Reply {
  const opts = cands.slice(0, 8);
  return {
    content: question,
    actions: opts.map((f, i) => ({ kind: "suggest", text: `${i + 1}` }) as AssistantAction),
    table: { columns: ["#", "Linha"], rows: opts.map((f, i) => [i + 1, rowLabel(f.columns, f.row, skipClient)]) },
    state: { ...state, choice: { kind: "record", options: opts.map((f) => ({ id: f.row.record.id, label: rowLabel(f.columns, f.row, skipClient), sheetId: f.sheet.id })), text } },
    handled: true,
  };
}

function add(ctx: ToolCtx, p: Parsed, state: ConvState, page: PageContext, forced: Forced): Reply {
  const r = resolveClient(ctx, p, state, page, forced, { useContext: true });
  if (r.ambiguous.length) return askClient(r.ambiguous, state, p.text);
  if (r.unknownName && !r.client) return { content: "Não encontrei esse cliente. Confira o nome em Clientes.", state, handled: true };
  const client = r.client;
  const month = p.month ?? (p.date ? Number(p.date.slice(5, 7)) : null);
  const { sheet, options } = targetSheet(ctx, p, state, page, forced, client, { preferAmount: true, month: month ?? undefined });
  let target = sheet;
  if (!target && !options.length && !month) {
    // Sem mês citado: usa a planilha do mês atual.
    const now = new Date();
    const cur = sheetsFor(ctx, client?.id ?? null, now.getMonth() + 1, now.getFullYear()).filter((s) => hasAmountColumn(ctx, s.id));
    if (cur.length === 1) target = cur[0];
    else if (cur.length > 1) return chooseSheetReply(cur, state, p.text, "Em qual planilha devo lançar?", client?.id);
  }
  if (!target) {
    if (options.length) return chooseSheetReply(options, state, p.text, "Em qual planilha devo lançar?", client?.id);
    return {
      content: `Não encontrei uma planilha${client ? ` de ${client.name}` : ""}${month ? ` em ${MONTHS_PT[month - 1].toLowerCase()}` : " para este mês"}. Quer que eu crie?`,
      actions: month ? suggest(`Crie a planilha de ${MONTHS_PT[month - 1].toLowerCase()} com base na anterior`) : undefined,
      state,
      handled: true,
    };
  }
  const meta = sheetColumns(ctx, target.id);
  if (meta.clientColumn && !client)
    return { content: `Para qual cliente é esse lançamento em “${target.title}”?`, state: { ...state, spreadsheetId: target.id, awaiting: { text: p.text, need: "client" } }, handled: true };

  const values: Record<string, unknown> = {};
  const cols = meta.columns;
  const amountCol = findRole(cols, "amount");
  const notes: string[] = [];
  if (p.amount !== null) {
    if (amountCol && amountCol.type !== "formula") values[amountCol.name] = p.amount;
    else {
      const unit = findRole(cols, "unit_value");
      if (amountCol?.type === "formula" && unit) {
        values[unit.name] = p.amount;
        notes.push(`“${amountCol.name}” é calculada; lancei o valor em “${unit.name}”.`);
      } else if (!amountCol) return { content: `A planilha “${target.title}” não tem uma coluna de valor configurada. Configure o papel “Valor pago” no cabeçalho da coluna.`, state, handled: true };
    }
  }
  const dateCol = findRole(cols, "payment_date") ?? findRole(cols, "date");
  if (dateCol && (p.date || p.day)) {
    const iso = p.date ?? makeIsoDate(meta.year ?? new Date().getFullYear(), meta.month ?? new Date().getMonth() + 1, p.day!);
    if (iso) values[dateCol.name] = formatDateBR(iso);
  }
  const statusCol = findRole(cols, "status");
  if (statusCol && p.amount !== null) {
    if (p.wantsPending && statusCol.pendingValues?.length) values[statusCol.name] = statusCol.pendingValues[0];
    else if (statusCol.paidValues?.length && /\bpagamento|pago|recebid/.test(p.norm)) values[statusCol.name] = statusCol.paidValues[0];
  }
  const workerCol = findRole(cols, "worker");
  if (workerCol) {
    const names = ctx.core.db
      .all<{ v: string | null }>("SELECT DISTINCT json_extract(data, '$.' || ?) AS v FROM records WHERE spreadsheet_id = ? AND deleted_at IS NULL", [workerCol.id, target.id])
      .map((x) => x.v)
      .filter((v): v is string => !!v);
    const w = pickClear(findMentions(p.text, names, (n) => [n]));
    if (w.clear) values[workerCol.name] = w.clear;
  }
  const obs = p.text.match(/\b(?:obs|observa[cç][aã]o)\s*[:=-]\s*(.+)$/i)?.[1];
  const notesCol = findRole(cols, "notes");
  if (obs && notesCol) values[notesCol.name] = obs.trim();
  if (!Object.keys(values).length) return { content: "O que devo preencher na nova linha? Por exemplo: “adicione um pagamento de R$ 350 no dia 12”.", state, handled: true };
  try {
    const prepared = prepareAddRecord(ctx, { spreadsheetId: target.id, clientId: client?.id ?? null, values });
    prepared.warnings.push(...notes);
    return pendingReply(ctx, prepared, { ...state, spreadsheetId: target.id, clientId: client?.id ?? state.clientId ?? null }, `Vou adicionar esta linha em **${target.title}**${client ? ` para ${client.name}` : ""}:`);
  } catch (e) {
    return errorReply(e, state);
  }
}

function update(ctx: ToolCtx, p: Parsed, state: ConvState, page: PageContext, forced: Forced): Reply {
  const r = resolveClient(ctx, p, state, page, forced, { useContext: true });
  if (r.ambiguous.length) return askClient(r.ambiguous, state, p.text);
  const client = r.client;
  // "de 350 para 400" → valor antigo e novo.
  const fromTo = p.low.match(/\bde\s+(?:r\$\s*)?(\d[\d.]*(?:,\d{1,2})?)\s+(?:para|pra)\s+(?:r\$\s*)?(\d[\d.]*(?:,\d{1,2})?)/);
  const oldAmount = fromTo ? parseNumberBR(fromTo[1]) : null;
  const newAmount = fromTo ? parseNumberBR(fromTo[2]) : p.amount;

  let recordId = forced.recordId ?? null;
  let sheetId: string | null = forced.spreadsheetId ?? null;
  if (!recordId && p.refersToContextRecord && state.recordIds?.length === 1 && state.spreadsheetId) {
    recordId = state.recordIds[0];
    sheetId = state.spreadsheetId;
  }
  let sheet: SheetRef | null = sheetId ? searchById(ctx, sheetId) : null;
  if (!sheet) {
    const t = targetSheet(ctx, p, state, page, forced, client, { preferAmount: newAmount !== null });
    if (!t.sheet) {
      if (t.options.length) return chooseSheetReply(t.options, state, p.text, "Em qual planilha está o lançamento?", client?.id);
      return { content: "Não encontrei a planilha desse lançamento. Abra a planilha ou diga o cliente e o mês.", state, handled: true };
    }
    sheet = t.sheet;
  }
  const meta = sheetColumns(ctx, sheet.id);
  const cols = meta.columns;

  // Qual coluna mudar?
  let column: Column | undefined;
  let value: unknown;
  const statusCol = findRole(cols, "status");
  const named = p.norm.match(/\b(?:o|a)?\s*(valor do plantao|valor plantao|data|situacao|status|observacao|obs|turno|regime|faltas|quantidade|plantoes)\b/)?.[1];
  if (/\b(marc\w*|deix\w*|coloc\w*)\b.*\b(como )?(pago|paga|pendente|parcial)\b/.test(p.norm) || (/\b(pago|pendente|parcial)\b/.test(p.norm) && newAmount === null)) {
    column = statusCol;
    const word = p.norm.match(/\b(pago|paga|pendente|parcial)\b/)?.[1] ?? "";
    value = column?.options?.find((o) => normalize(o).startsWith(word.slice(0, 4))) ?? word.toUpperCase();
  } else if (named && /data/.test(named) && (p.date || p.day)) {
    column = findRole(cols, "payment_date") ?? findRole(cols, "date");
    const iso = p.date ?? makeIsoDate(meta.year ?? new Date().getFullYear(), meta.month ?? new Date().getMonth() + 1, p.day!);
    value = iso ? formatDateBR(iso) : null;
  } else if (named && !/data|situacao|status/.test(named) && newAmount !== null) {
    column = columnByNameOrRole(cols, named);
    value = newAmount;
  } else if (newAmount !== null) {
    column = findRole(cols, "amount");
    if (column?.type === "formula") {
      return {
        content: `Em “${sheet.title}”, “${column.name}” é calculada automaticamente. Diga qual campo mudar, por exemplo “altere o valor do plantão para R$ ${formatMoney(newAmount).replace("R$", "").trim()}”.`,
        state,
        handled: true,
      };
    }
    value = newAmount;
  } else if (p.date || p.day) {
    column = findRole(cols, "payment_date") ?? findRole(cols, "date");
    const iso = p.date ?? makeIsoDate(meta.year ?? new Date().getFullYear(), meta.month ?? new Date().getMonth() + 1, p.day!);
    value = iso ? formatDateBR(iso) : null;
  }
  if (!column) return { content: "Não entendi o que devo alterar. Exemplo: “altere o valor deste pagamento para R$ 400”.", state, handled: true };

  if (!recordId) {
    const cands = candidateRecords(ctx, p, sheet, client, oldAmount);
    if (!cands.length) return { content: `Não encontrei o lançamento${client ? ` de ${client.name}` : ""} em “${sheet.title}”.`, state, handled: true };
    if (cands.length > 1)
      return chooseRecordReply(cands, { ...state, spreadsheetId: sheet.id, clientId: client?.id ?? state.clientId }, p.text, `Encontrei ${cands.length} lançamentos${client ? ` de ${client.name}` : ""} em “${sheet.title}”. Qual deles devo alterar?`, !!client);
    recordId = cands[0].row.record.id;
  }
  try {
    const prepared = prepareUpdateRecord(ctx, { spreadsheetId: sheet.id, recordId, values: { [column.name]: value as string | number } });
    return pendingReply(ctx, prepared, { ...state, spreadsheetId: sheet.id, recordIds: [recordId], clientId: client?.id ?? state.clientId ?? null }, `Vou alterar em **${sheet.title}**:`);
  } catch (e) {
    return errorReply(e, state);
  }
}

function remove(ctx: ToolCtx, p: Parsed, state: ConvState, page: PageContext, forced: Forced): Reply {
  if (/\bplanilha\b/.test(p.norm) && !/\b(linha|pagamento|lancamento|registro)\b/.test(p.norm))
    return { content: "Por segurança, a exclusão de planilhas inteiras é feita pela tela de Planilhas (menu ⋯ → Excluir). Ela vai para a lixeira e pode ser recuperada.", state, handled: true };
  const r = resolveClient(ctx, p, state, page, forced, { useContext: true });
  if (r.ambiguous.length) return askClient(r.ambiguous, state, p.text);
  const client = r.client;
  let recordId = forced.recordId ?? null;
  let sheet: SheetRef | null = forced.spreadsheetId ? searchById(ctx, forced.spreadsheetId) : null;
  if (!recordId && p.refersToContextRecord && state.recordIds?.length === 1 && state.spreadsheetId) {
    recordId = state.recordIds[0];
    sheet = searchById(ctx, state.spreadsheetId);
  }
  if (!sheet) {
    const t = targetSheet(ctx, p, state, page, forced, client);
    if (!t.sheet) {
      if (t.options.length) return chooseSheetReply(t.options, state, p.text, "Em qual planilha está a linha?", client?.id);
      return { content: "Não encontrei a planilha. Abra a planilha ou diga o cliente e o mês.", state, handled: true };
    }
    sheet = t.sheet;
  }
  if (!recordId) {
    const cands = candidateRecords(ctx, p, sheet, client, p.amount);
    if (!cands.length) return { content: `Não encontrei a linha${client ? ` de ${client.name}` : ""} em “${sheet.title}”.`, state, handled: true };
    if (cands.length > 1) return chooseRecordReply(cands, { ...state, spreadsheetId: sheet.id }, p.text, `Qual linha devo excluir de “${sheet.title}”?`, !!client);
    recordId = cands[0].row.record.id;
  }
  try {
    return pendingReply(ctx, prepareDeleteRecord(ctx, { spreadsheetId: sheet.id, recordIds: [recordId] }), { ...state, spreadsheetId: sheet.id });
  } catch (e) {
    return errorReply(e, state);
  }
}

function create(ctx: ToolCtx, p: Parsed, state: ConvState, page: PageContext, forced: Forced): Reply {
  const now = new Date();
  const month = p.month ?? (p.norm.includes("proximo mes") ? (now.getMonth() + 1) % 12 + 1 : null);
  if (!month) return { content: "Para qual mês? Exemplo: “crie a planilha de novembro com base na de outubro”.", state, handled: true };
  const baseMonth = p.baseMonth ?? (month === 1 ? 12 : month - 1);
  let year = p.year ?? now.getFullYear();
  if (!p.year && month < now.getMonth() + 1 - 6) year = now.getFullYear() + 1;
  const baseYear = p.baseYear ?? (baseMonth > month ? year - 1 : year);

  let template: SheetRef | null = forced.spreadsheetId ? searchById(ctx, forced.spreadsheetId) : null;
  if (!template) {
    let bases = sheetsFor(ctx, null, baseMonth, baseYear);
    if (!bases.length && !p.baseYear) bases = sheetsFor(ctx, null, baseMonth, null);
    const ctxSheet = page.spreadsheetId ?? state.spreadsheetId;
    if (bases.length > 1 && ctxSheet) {
      const cat = searchById(ctx, ctxSheet)?.category;
      const same = bases.filter((b) => b.category === cat);
      if (same.length === 1) bases = same;
    }
    if (bases.length > 1) return chooseSheetReply(bases, state, p.text, `Há ${bases.length} planilhas de ${MONTHS_PT[baseMonth - 1].toLowerCase()}. Qual devo usar como modelo?`);
    template = bases[0] ?? null;
  }
  const copy = /\b(so a estrutura|somente a estrutura|vazia|em branco|sem linhas)\b/.test(p.norm) ? "none" : /\b(tudo|completa|inteira|todos os dados|com os valores)\b/.test(p.norm) ? "all" : "carry";
  try {
    const prepared = prepareCreateSpreadsheet(ctx, { templateId: template?.id, month, year, copy });
    if (!template && p.baseMonth) prepared.warnings.push(`Não achei planilha de ${MONTHS_PT[p.baseMonth - 1].toLowerCase()} para usar como modelo; será criada uma planilha simples.`);
    return pendingReply(ctx, prepared, state, `Vou criar a planilha de ${MONTHS_PT[month - 1].toLowerCase()} de ${year}${template ? ` com base em **${template.title}**` : ""}:`);
  } catch (e) {
    return errorReply(e, state);
  }
}

function contextSheetOrAsk(ctx: ToolCtx, p: Parsed, state: ConvState, page: PageContext, forced: Forced, what: string): { sheet: SheetRef | null; reply: Reply | null; client: ClientSummary | null } {
  const r = resolveClient(ctx, p, state, page, forced, { useContext: false });
  if (r.ambiguous.length) return { sheet: null, reply: askClient(r.ambiguous, state, p.text), client: null };
  const t = targetSheet(ctx, p, state, page, forced, r.client);
  if (t.sheet) return { sheet: t.sheet, reply: null, client: r.client };
  if (t.options.length) return { sheet: null, reply: chooseSheetReply(t.options, state, p.text, `De qual planilha devo ${what}?`, r.client?.id), client: r.client };
  return { sheet: null, reply: { content: `Abra uma planilha ou diga qual (cliente e mês) para eu ${what}.`, state, handled: true }, client: r.client };
}

function exportIntent(ctx: ToolCtx, p: Parsed, state: ConvState, page: PageContext, forced: Forced): Reply {
  const { sheet, reply, client } = contextSheetOrAsk(ctx, p, state, page, forced, "exportar");
  if (!sheet) return reply!;
  const clientId = client && sheetHasClient(ctx, sheet.id, client.id) ? client.id : page.clientId ?? null;
  const formats: ("pdf" | "xlsx")[] = p.format ? [p.format] : ["pdf", "xlsx"];
  const actions = formats.map((f) => {
    const l = exportLink(ctx, { spreadsheetId: sheet.id, format: f, clientId });
    return { kind: "download", url: l.url, label: f === "pdf" ? "Baixar PDF" : "Baixar Excel" } as AssistantAction;
  });
  return { content: `Pronto, é só baixar **${sheet.title}**${clientId && client ? ` (somente ${client.name})` : ""}:`, actions, state: { ...state, spreadsheetId: sheet.id }, handled: true };
}

function history(ctx: ToolCtx, p: Parsed, state: ConvState, page: PageContext, forced: Forced): Reply {
  const r = resolveClient(ctx, p, state, page, forced, { useContext: false });
  const sheetId = forced.spreadsheetId ?? (p.refersToContextSheet || !r.client ? page.spreadsheetId ?? state.spreadsheetId : null) ?? undefined;
  const events = changeHistory(ctx, { spreadsheetId: sheetId, clientId: sheetId ? undefined : r.client?.id, limit: 10 });
  if (!events.length) return { content: "Não há alterações registradas para isso ainda.", state, handled: true };
  return {
    content: `Últimas ${events.length} alteração(ões)${r.client && !sheetId ? ` de ${r.client.name}` : sheetId ? " desta planilha" : ""}:`,
    table: {
      columns: ["Quando", "Quem", "Origem", "O que"],
      rows: events.map((e) => [new Date(e.quando).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }), e.quem ?? "Sistema", originLabel(e.origem), e.resumo]),
    },
    state,
    handled: true,
  };
}

function originLabel(o: string) {
  return o === "ai" ? "Assistente" : o === "import" ? "Importação" : o === "system" ? "Sistema" : "Tela";
}

function restore(ctx: ToolCtx, p: Parsed, state: ConvState, page: PageContext, forced: Forced): Reply {
  const { sheet, reply } = contextSheetOrAsk(ctx, p, state, page, forced, "restaurar");
  if (!sheet) return reply!;
  if (p.versionNumber) {
    try {
      return pendingReply(ctx, prepareRestoreVersion(ctx, { spreadsheetId: sheet.id, versionNumber: p.versionNumber }), { ...state, spreadsheetId: sheet.id });
    } catch (e) {
      return errorReply(e, state);
    }
  }
  const versions = listVersions(ctx.core, ctx.actor, sheet.id).slice(0, 8);
  if (!versions.length) return { content: "Esta planilha ainda não tem versões salvas.", state, handled: true };
  return {
    content: `Versões de **${sheet.title}**. Diga, por exemplo, “restaurar versão ${versions[Math.min(1, versions.length - 1)].number}”.`,
    table: {
      columns: ["Versão", "Quando", "Quem", "Motivo", "Linhas"],
      rows: versions.map((v) => [v.number, new Date(v.createdAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }), v.createdByName ?? "—", v.reason, v.rowCount]),
    },
    actions: versions.slice(0, 3).map((v) => ({ kind: "suggest", text: `Restaurar versão ${v.number}` }) as AssistantAction),
    state: { ...state, spreadsheetId: sheet.id },
    handled: true,
  };
}

function undo(ctx: ToolCtx, state: ConvState): Reply {
  const last = lastDoneAction(ctx);
  if (!last)
    return {
      content: "Não encontrei uma ação recente da assistente para desfazer. Alterações feitas direto na planilha podem ser revertidas em Histórico → Versões.",
      state,
      handled: true,
    };
  try {
    return { content: undoPending(ctx, last.id), state: { ...state, recordIds: [] }, handled: true };
  } catch (e) {
    return errorReply(e, state);
  }
}

// ------------------------------------------------------------------ entrada principal

export function respond(ctx: ToolCtx, text: string, state: ConvState, page: PageContext, forced: Forced = {}): Reply {
  const p = parse(text);

  // Resposta a uma pergunta de escolha ("2", "o segundo", ou o nome de uma opção).
  if (state.choice && !forced.clientId && !forced.recordId && !forced.spreadsheetId) {
    const opts = state.choice.options;
    let picked: (typeof opts)[number] | undefined;
    if (p.intent === "choose" && p.choiceIndex) picked = p.choiceIndex === -1 ? opts[opts.length - 1] : opts[p.choiceIndex - 1];
    else if (/^\d+\.\s/.test(text.trim())) picked = opts[Number(text.trim().split(".")[0]) - 1];
    else if (["unknown", "open", "find"].includes(p.intent)) {
      const m = pickClear(findMentions(text, opts, (o) => [o.label]));
      picked = m.clear ?? undefined;
    }
    if (picked) {
      const f: Forced =
        state.choice.kind === "client" ? { clientId: picked.id } : state.choice.kind === "spreadsheet" ? { spreadsheetId: picked.id } : { recordId: picked.id, spreadsheetId: picked.sheetId };
      return respond(ctx, state.choice.text, { ...state, choice: null }, page, f);
    }
    if (p.intent === "choose") return { content: "Não encontrei essa opção. Responda com o número da lista.", state, handled: true };
  }

  // Resposta a "de qual cliente?".
  if (state.awaiting && ["unknown", "open", "find", "choose"].includes(p.intent)) {
    const clients = listClients(ctx.core, ctx.actor);
    const m = pickClear(findMentions(text, clients, (c) => [c.name, ...c.aliases]));
    if (m.clear) return respond(ctx, state.awaiting.text, { ...state, awaiting: null }, page, { clientId: m.clear.id });
    if (m.ambiguous.length) return askClient(m.ambiguous, { ...state, awaiting: null }, state.awaiting.text);
  }

  if (p.intent === "confirm" && state.pendingId) return { content: "__confirm__", state, handled: true };
  if (p.intent === "cancel" && state.pendingId) return { content: "__cancel__", state, handled: true };

  const st: ConvState = { ...state, choice: null, awaiting: null };
  try {
    switch (p.intent) {
      case "help":
        return help(st);
      case "thanks":
        return { content: "Por nada! Se precisar, é só pedir.", state: st, handled: true };
      case "undo":
        return undo(ctx, st);
      case "history":
        return history(ctx, p, st, page, forced);
      case "restore":
        return restore(ctx, p, st, page, forced);
      case "export":
        return exportIntent(ctx, p, st, page, forced);
      case "create":
        return create(ctx, p, st, page, forced);
      case "delete":
        return remove(ctx, p, st, page, forced);
      case "update":
        return update(ctx, p, st, page, forced);
      case "add":
        return add(ctx, p, st, page, forced);
      case "pending":
        return pending(ctx, p, st, page, forced);
      case "totals":
        return totals(ctx, p, st, page, forced);
      case "clients":
        return clientsList(ctx, st);
      case "find":
        return find(ctx, p, st, page, forced);
      case "open":
        return open(ctx, p, st, page, forced);
      case "choose":
      case "confirm":
      case "cancel":
        return { content: "Não há nada aguardando sua resposta agora. Como posso ajudar?", actions: suggest(...SUGGESTIONS.slice(0, 3)), state: st, handled: true };
      default: {
        // Só um nome? Mostra as planilhas desse cliente.
        const clients = listClients(ctx.core, ctx.actor);
        const m = pickClear(findMentions(text, clients, (c) => [c.name, ...c.aliases]));
        if (m.clear && p.tokens.length <= 6) return listSheets(ctx, p, st, m.clear);
        if (forced.clientId) return listSheets(ctx, p, st, clients.find((c) => c.id === forced.clientId) ?? null);
        return {
          content: "Não entendi bem o pedido. Tente uma destas formas:",
          actions: suggest(...SUGGESTIONS),
          state: st,
          handled: false,
        };
      }
    }
  } catch (e) {
    return errorReply(e, st);
  }
}

export { SUGGESTIONS, clientName };
