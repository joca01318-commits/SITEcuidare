import type { Actor, Core } from "../core.js";
import type {
  AuditDetail,
  AuditSource,
  CellConflict,
  CellOp,
  CellValue,
  Column,
  RowData,
  SheetRecord,
  SpreadsheetDetail,
  SpreadsheetSummary,
} from "../../shared/types.js";
import { MONTHS_PT } from "../../shared/types.js";
import { coerceValue, isNumericColumn, newColumnId } from "../../shared/columns.js";
import { computeRow, FormulaError, FormulaSyntaxError, referencedColumns, toStoredFormula, isCellFormula, type Value } from "../../shared/formula.js";
import { normalize, sumMoney, parseNumberBR } from "../../shared/text.js";
import { json } from "../db/db.js";
import { AppError, badRequest, conflict, forbidden, newId, notFound, nowIso } from "../lib/util.js";
import { audit } from "./audit.js";
import { can, canSeeClient, maskSensitive, require } from "./access.js";
import { resolveClientId } from "./clients.js";
import { indexSpreadsheet, removeFromIndex } from "./search.js";

export const MAX_ROWS = 20_000;
export const MAX_COLUMNS = 120;

export interface SheetRow {
  id: string;
  org_id: string;
  title: string;
  category: string;
  client_id: string | null;
  year: number | null;
  month: number | null;
  columns: string;
  client_column: string | null;
  schema_rev: number;
  data_rev: number;
  source_file_id: string | null;
  workbook: string | null;
  import_notes: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
  deleted_at: string | null;
}

interface RecordRow {
  id: string;
  spreadsheet_id: string;
  position: number;
  client_id: string | null;
  data: string;
  rev: number;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
  updated_by_name?: string | null;
  deleted_at: string | null;
}

export interface LoadedSheet {
  row: SheetRow;
  columns: Column[];
}

// ------------------------------------------------------------------ acesso

/** Carrega a planilha verificando organização e escopo de clientes do usuário. */
export function loadSheet(core: Core, actor: Actor, id: string, opts: { allowDeleted?: boolean } = {}): LoadedSheet {
  const row = core.db.get<SheetRow>("SELECT * FROM spreadsheets WHERE id = ? AND org_id = ?", [id, actor.orgId]);
  if (!row || (row.deleted_at && !opts.allowDeleted)) throw notFound("Planilha");
  if (!actor.scopeAll && !sheetVisibleToRestricted(core, actor, row)) throw notFound("Planilha");
  return { row, columns: json<Column[]>(row.columns, []) };
}

function sheetVisibleToRestricted(core: Core, actor: Actor, row: SheetRow): boolean {
  if (row.client_id && canSeeClient(actor, row.client_id)) return true;
  const ids = [...actor.clientIds];
  if (!ids.length) return false;
  return !!core.db.get(
    `SELECT 1 FROM records WHERE spreadsheet_id = ? AND deleted_at IS NULL AND client_id IN (${ids.map(() => "?").join(",")}) LIMIT 1`,
    [row.id, ...ids],
  );
}

/** Usuário restrito só altera linhas dos seus clientes (ou planilhas de um cliente seu). */
function assertRowWritable(actor: Actor, sheet: SheetRow, rec: { client_id: string | null }) {
  if (actor.scopeAll) return;
  if (rec.client_id && canSeeClient(actor, rec.client_id)) return;
  if (!sheet.client_column && sheet.client_id && canSeeClient(actor, sheet.client_id)) return;
  throw forbidden("Você não tem permissão para alterar esta linha.");
}

// ------------------------------------------------------------------ leitura

function sheetLabel(row: Pick<SheetRow, "title">) {
  return `"${row.title}"`;
}

export function periodLabel(month: number | null, year: number | null): string {
  if (month && year) return `${MONTHS_PT[month - 1]} de ${year}`;
  if (month) return MONTHS_PT[month - 1];
  if (year) return String(year);
  return "";
}

export interface ListFilters {
  q?: string;
  clientId?: string;
  year?: number;
  month?: number;
  category?: string;
  favorites?: boolean;
  trash?: boolean;
  sort?: "updated" | "title" | "period";
  limit?: number;
}

export function listSpreadsheets(core: Core, actor: Actor, f: ListFilters = {}): SpreadsheetSummary[] {
  const where: string[] = ["s.org_id = ?"];
  const params: (string | number)[] = [actor.orgId];
  where.push(f.trash ? "s.deleted_at IS NOT NULL" : "s.deleted_at IS NULL");
  if (f.year) {
    where.push("s.year = ?");
    params.push(f.year);
  }
  if (f.month) {
    where.push("s.month = ?");
    params.push(f.month);
  }
  if (f.category) {
    where.push("s.category = ?");
    params.push(f.category);
  }
  if (f.favorites) {
    where.push("EXISTS (SELECT 1 FROM favorites fv WHERE fv.spreadsheet_id = s.id AND fv.user_id = ?)");
    params.push(actor.id);
  }
  if (f.clientId) {
    where.push("(s.client_id = ? OR EXISTS (SELECT 1 FROM records r WHERE r.spreadsheet_id = s.id AND r.client_id = ? AND r.deleted_at IS NULL))");
    params.push(f.clientId, f.clientId);
  }
  if (!actor.scopeAll) {
    const ids = [...actor.clientIds];
    if (!ids.length) return [];
    const ph = ids.map(() => "?").join(",");
    where.push(`(s.client_id IN (${ph}) OR EXISTS (SELECT 1 FROM records r WHERE r.spreadsheet_id = s.id AND r.deleted_at IS NULL AND r.client_id IN (${ph})))`);
    params.push(...ids, ...ids);
  }
  const order =
    f.sort === "title" ? "s.title COLLATE NOCASE" : f.sort === "period" ? "s.year DESC, s.month DESC, s.title COLLATE NOCASE" : "s.updated_at DESC";
  const countExpr = f.clientId
    ? "(SELECT COUNT(*) FROM records r WHERE r.spreadsheet_id = s.id AND r.deleted_at IS NULL AND (r.client_id = ? OR (s.client_id = ? AND s.client_column IS NULL)))"
    : "(SELECT COUNT(*) FROM records r WHERE r.spreadsheet_id = s.id AND r.deleted_at IS NULL)";
  const countParams = f.clientId ? [f.clientId, f.clientId] : [];
  const rows = core.db.all<SheetRow & { row_count: number; client_name: string | null; upd_name: string | null; fav: number; fmt: string | null; fname: string | null }>(
    `SELECT s.*, ${countExpr} AS row_count,
            c.name AS client_name, u.name AS upd_name, f.format AS fmt, f.original_name AS fname,
            EXISTS (SELECT 1 FROM favorites fv WHERE fv.spreadsheet_id = s.id AND fv.user_id = ?) AS fav
       FROM spreadsheets s
       LEFT JOIN clients c ON c.id = s.client_id
       LEFT JOIN users u ON u.id = s.updated_by
       LEFT JOIN files f ON f.id = s.source_file_id
      WHERE ${where.join(" AND ")}
      ORDER BY ${order}
      LIMIT ${Math.min(f.limit ?? 500, 1000)}`,
    [...countParams, actor.id, ...params],
  );
  let list = rows.map((r) => toSummary(r, r));
  if (f.q) {
    const q = normalize(f.q);
    const words = q.split(" ").filter(Boolean);
    list = list.filter((s) => {
      const hay = normalize([s.title, s.category, s.clientName, s.workbook, s.month ? MONTHS_PT[s.month - 1] : "", s.year ?? ""].join(" "));
      return words.every((w) => hay.includes(w));
    });
  }
  return list;
}

function toSummary(
  r: SheetRow,
  extra: { row_count: number; client_name: string | null; upd_name: string | null; fav: number; fmt: string | null; fname: string | null },
): SpreadsheetSummary {
  return {
    id: r.id,
    title: r.title,
    category: r.category,
    clientId: r.client_id,
    clientName: extra.client_name,
    year: r.year,
    month: r.month,
    rowCount: extra.row_count,
    updatedAt: r.updated_at,
    updatedByName: extra.upd_name,
    sourceFormat: extra.fmt,
    sourceFileName: extra.fname,
    workbook: r.workbook,
    favorite: !!extra.fav,
  };
}

export function readRecords(core: Core, actor: Actor, sheet: SheetRow, opts: { clientId?: string | null } = {}): SheetRecord[] {
  const where = ["r.spreadsheet_id = ?", "r.deleted_at IS NULL"];
  const params: string[] = [sheet.id];
  if (opts.clientId && sheet.client_column) {
    where.push("r.client_id = ?");
    params.push(opts.clientId);
  }
  if (!actor.scopeAll && !(sheet.client_id && canSeeClient(actor, sheet.client_id) && !sheet.client_column)) {
    const ids = [...actor.clientIds];
    where.push(ids.length ? `r.client_id IN (${ids.map(() => "?").join(",")})` : "0=1");
    params.push(...ids);
  }
  const rows = core.db.all<RecordRow>(`SELECT r.* FROM records r WHERE ${where.join(" AND ")} ORDER BY r.position`, params);
  return rows.map((r) => ({
    id: r.id,
    position: r.position,
    clientId: r.client_id,
    data: json<RowData>(r.data, {}),
    rev: r.rev,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
  }));
}

export function getSpreadsheet(core: Core, actor: Actor, id: string, opts: { clientId?: string | null; track?: boolean } = {}): SpreadsheetDetail {
  const { row, columns } = loadSheet(core, actor, id);
  if (opts.clientId && !canSeeClient(actor, opts.clientId)) throw notFound("Cliente");
  let records = readRecords(core, actor, row, { clientId: opts.clientId });
  if (!can(actor, "view_sensitive")) {
    const sensitive = columns.filter((c) => c.sensitive).map((c) => c.id);
    if (sensitive.length)
      records = records.map((r) => ({ ...r, data: { ...r.data, ...Object.fromEntries(sensitive.map((s) => [s, maskSensitive(r.data[s])])) } }));
  }
  const meta = core.db.get<{ client_name: string | null; upd_name: string | null; fmt: string | null; fname: string | null; fav: number }>(
    `SELECT c.name AS client_name, u.name AS upd_name, f.format AS fmt, f.original_name AS fname,
            EXISTS (SELECT 1 FROM favorites fv WHERE fv.spreadsheet_id = s.id AND fv.user_id = ?) AS fav
       FROM spreadsheets s LEFT JOIN clients c ON c.id = s.client_id LEFT JOIN users u ON u.id = s.updated_by
       LEFT JOIN files f ON f.id = s.source_file_id WHERE s.id = ?`,
    [actor.id, id],
  )!;
  if (opts.track !== false) {
    trackRecent(core, actor, "spreadsheet", id);
    if (opts.clientId) trackRecent(core, actor, "client", opts.clientId);
  }
  return {
    ...toSummary(row, { ...meta, row_count: records.length }),
    columns,
    clientColumn: row.client_column,
    schemaRev: row.schema_rev,
    dataRev: row.data_rev,
    records,
    filteredClientId: opts.clientId && row.client_column ? opts.clientId : null,
    filteredClientName:
      opts.clientId && row.client_column ? core.db.get<{ name: string }>("SELECT name FROM clients WHERE id = ?", [opts.clientId])?.name ?? null : null,
    canEdit: can(actor, "edit"),
    importNotes: json<string[]>(row.import_notes, []),
  };
}

export function trackRecent(core: Core, actor: Actor, kind: "spreadsheet" | "client", refId: string) {
  core.db.run(
    "INSERT INTO recents (user_id, kind, ref_id, viewed_at) VALUES (?,?,?,?) ON CONFLICT(user_id, kind, ref_id) DO UPDATE SET viewed_at = excluded.viewed_at",
    [actor.id, kind, refId, nowIso()],
  );
}

// ------------------------------------------------------------------ cálculo

export interface ComputedRow {
  record: SheetRecord;
  values: Record<string, Value>;
}

export function computeRecords(columns: Column[], records: SheetRecord[]): ComputedRow[] {
  return records.map((record) => ({ record, values: computeRow(record.data, columns) }));
}

export interface ColumnTotal {
  columnId: string;
  name: string;
  sum: number;
  count: number;
  errors: number;
  currency: boolean;
}

/** Totais determinísticos (em centavos para valores monetários). */
export function totalsFor(columns: Column[], rows: ComputedRow[]): ColumnTotal[] {
  const out: ColumnTotal[] = [];
  for (const col of columns) {
    if (!isNumericColumn(col)) continue;
    const nums: number[] = [];
    let errors = 0;
    for (const r of rows) {
      const v = r.values[col.id];
      if (v instanceof FormulaError) errors++;
      else if (typeof v === "number") nums.push(v);
      else if (typeof v === "string" && v.trim()) {
        const n = parseNumberBR(v);
        if (n !== null) nums.push(n);
      }
    }
    const currency = col.type === "currency" || col.role === "amount" || col.role === "unit_value";
    out.push({
      columnId: col.id,
      name: col.name,
      sum: currency ? sumMoney(nums) : Math.round(nums.reduce((s, n) => s + n, 0) * 1e6) / 1e6,
      count: nums.length,
      errors,
      currency,
    });
  }
  return out;
}

export function groupTotals(columns: Column[], rows: ComputedRow[], groupBy: string) {
  const groups = new Map<string, ComputedRow[]>();
  for (const r of rows) {
    const raw = r.values[groupBy];
    const key = raw === null || raw === undefined || raw === "" ? "(vazio)" : String(raw instanceof FormulaError ? raw.code : raw);
    const arr = groups.get(key) ?? [];
    arr.push(r);
    groups.set(key, arr);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "pt-BR"))
    .map(([key, rs]) => ({ key, rows: rs.length, totals: totalsFor(columns, rs) }));
}

// ------------------------------------------------------------------ eventos

export type SheetEvent =
  | { type: "cells"; by: string; byName: string; changes: { recordId: string; columnId: string; value: CellValue; rev: number }[]; dataRev: number }
  | { type: "rows"; by: string; byName: string; dataRev: number }
  | { type: "schema"; by: string; byName: string; schemaRev: number }
  | { type: "reload"; by: string; byName: string; reason: string };

export function emit(core: Core, sheetId: string, ev: SheetEvent) {
  core.bus.emit(`sheet:${sheetId}`, ev);
  core.bus.emit("activity", { sheetId, ...ev });
}

function touch(core: Core, actor: Actor, sheetId: string, field: "data_rev" | "schema_rev" | "both"): { dataRev: number; schemaRev: number } {
  const set =
    field === "both" ? "data_rev = data_rev + 1, schema_rev = schema_rev + 1" : field === "data_rev" ? "data_rev = data_rev + 1" : "schema_rev = schema_rev + 1";
  core.db.run(`UPDATE spreadsheets SET ${set}, updated_at = ?, updated_by = ? WHERE id = ?`, [nowIso(), actor.id, sheetId]);
  const r = core.db.get<{ data_rev: number; schema_rev: number }>("SELECT data_rev, schema_rev FROM spreadsheets WHERE id = ?", [sheetId])!;
  return { dataRev: r.data_rev, schemaRev: r.schema_rev };
}

// ------------------------------------------------------------------ versões

interface Snapshot {
  title: string;
  columns: Column[];
  clientColumn: string | null;
  dataRev: number;
  records: { id: string; position: number; clientId: string | null; data: RowData }[];
}

export function snapshot(core: Core, actor: Actor, sheetId: string, reason: string, source: AuditSource): number {
  const row = core.db.get<SheetRow>("SELECT * FROM spreadsheets WHERE id = ?", [sheetId])!;
  const recs = core.db.all<RecordRow>("SELECT * FROM records WHERE spreadsheet_id = ? AND deleted_at IS NULL ORDER BY position", [sheetId]);
  const snap: Snapshot = {
    title: row.title,
    columns: json<Column[]>(row.columns, []),
    clientColumn: row.client_column,
    dataRev: row.data_rev,
    records: recs.map((r) => ({ id: r.id, position: r.position, clientId: r.client_id, data: json<RowData>(r.data, {}) })),
  };
  const number = (core.db.get<{ n: number | null }>("SELECT MAX(number) n FROM versions WHERE spreadsheet_id = ?", [sheetId])!.n ?? 0) + 1;
  core.db.run("INSERT INTO versions (id, spreadsheet_id, number, reason, source, snapshot, row_count, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)", [
    newId("ver"),
    sheetId,
    number,
    reason.slice(0, 200),
    source,
    JSON.stringify(snap),
    snap.records.length,
    actor.id,
    nowIso(),
  ]);
  return number;
}

/**
 * Antes de uma sequência de edições, guarda uma versão se a última for antiga
 * (30 min) e houver mudanças desde então. Assim cada "sessão de edição" é recuperável.
 */
export function autoSnapshot(core: Core, actor: Actor, sheetId: string, source: AuditSource) {
  const last = core.db.get<{ created_at: string; snapshot_rev: number }>(
    "SELECT created_at, json_extract(snapshot, '$.dataRev') AS snapshot_rev FROM versions WHERE spreadsheet_id = ? ORDER BY number DESC LIMIT 1",
    [sheetId],
  );
  const rev = core.db.get<{ data_rev: number }>("SELECT data_rev FROM spreadsheets WHERE id = ?", [sheetId])!.data_rev;
  if (!last) {
    snapshot(core, actor, sheetId, "Estado antes das primeiras edições", source);
    return;
  }
  const old = Date.now() - Date.parse(last.created_at) > 30 * 60_000;
  if (old && rev !== last.snapshot_rev) snapshot(core, actor, sheetId, "Salvamento automático antes de novas edições", source);
}

export function listVersions(core: Core, actor: Actor, sheetId: string) {
  loadSheet(core, actor, sheetId, { allowDeleted: true });
  return core.db
    .all<{ id: string; number: number; reason: string; source: string; row_count: number; created_at: string; name: string | null }>(
      `SELECT v.id, v.number, v.reason, v.source, v.row_count, v.created_at, u.name
         FROM versions v LEFT JOIN users u ON u.id = v.created_by WHERE v.spreadsheet_id = ? ORDER BY v.number DESC LIMIT 200`,
      [sheetId],
    )
    .map((v) => ({ id: v.id, number: v.number, reason: v.reason, source: v.source, rowCount: v.row_count, createdAt: v.created_at, createdByName: v.name }));
}

export function getVersionPreview(core: Core, actor: Actor, sheetId: string, versionId: string) {
  loadSheet(core, actor, sheetId, { allowDeleted: true });
  if (!actor.scopeAll) throw forbidden("A pré-visualização de versões é restrita a usuários com acesso a todos os clientes.");
  const v = core.db.get<{ snapshot: string; number: number; created_at: string }>("SELECT snapshot, number, created_at FROM versions WHERE id = ? AND spreadsheet_id = ?", [
    versionId,
    sheetId,
  ]);
  if (!v) throw notFound("Versão");
  const snap = json<Snapshot>(v.snapshot, { title: "", columns: [], clientColumn: null, dataRev: 0, records: [] });
  return { number: v.number, createdAt: v.created_at, columns: snap.columns, records: snap.records.slice(0, 500), totalRows: snap.records.length };
}

/** Restaura uma versão. Gera uma nova versão e um evento: nada do histórico é apagado. */
export function restoreVersion(core: Core, actor: Actor, sheetId: string, versionId: string, source: AuditSource = "ui") {
  require(actor, "restore");
  if (!actor.scopeAll) throw forbidden("Restaurar versões exige acesso a todos os clientes da planilha.");
  const { row } = loadSheet(core, actor, sheetId);
  const v = core.db.get<{ snapshot: string; number: number }>("SELECT snapshot, number FROM versions WHERE id = ? AND spreadsheet_id = ?", [versionId, sheetId]);
  if (!v) throw notFound("Versão");
  const snap = json<Snapshot | null>(v.snapshot, null);
  if (!snap) throw new AppError(500, "corrupt", "Esta versão está corrompida e não pode ser restaurada.");
  return core.db.tx(() => {
    const backupNumber = snapshot(core, actor, sheetId, `Antes de restaurar a versão ${v.number}`, source);
    const now = nowIso();
    const keep = new Set(snap.records.map((r) => r.id));
    const current = core.db.all<{ id: string }>("SELECT id FROM records WHERE spreadsheet_id = ? AND deleted_at IS NULL", [sheetId]);
    let removed = 0;
    for (const c of current)
      if (!keep.has(c.id)) {
        core.db.run("UPDATE records SET deleted_at = ?, updated_at = ?, updated_by = ? WHERE id = ?", [now, now, actor.id, c.id]);
        removed++;
      }
    for (const r of snap.records) {
      const exists = core.db.get("SELECT 1 FROM records WHERE id = ?", [r.id]);
      if (exists)
        core.db.run("UPDATE records SET position = ?, client_id = ?, data = ?, rev = rev + 1, deleted_at = NULL, updated_at = ?, updated_by = ? WHERE id = ?", [
          r.position,
          r.clientId,
          JSON.stringify(r.data),
          now,
          actor.id,
          r.id,
        ]);
      else
        core.db.run(
          "INSERT INTO records (id, spreadsheet_id, position, client_id, data, created_at, created_by, updated_at, updated_by) VALUES (?,?,?,?,?,?,?,?,?)",
          [r.id, sheetId, r.position, r.clientId, JSON.stringify(r.data), now, actor.id, now, actor.id],
        );
    }
    core.db.run("UPDATE spreadsheets SET columns = ?, client_column = ? WHERE id = ?", [JSON.stringify(snap.columns), snap.clientColumn, sheetId]);
    const revs = touch(core, actor, sheetId, "both");
    audit(core, actor, {
      source,
      action: "version.restore",
      entityType: "spreadsheet",
      entityId: sheetId,
      spreadsheetId: sheetId,
      clientId: row.client_id,
      summary: `Versão ${v.number} de ${sheetLabel(row)} restaurada (${snap.records.length} linhas; ${removed} removidas). Estado anterior guardado como versão ${backupNumber}.`,
    });
    emit(core, sheetId, { type: "reload", by: actor.id, byName: actor.name, reason: `${actor.name} restaurou a versão ${v.number}` });
    return { restoredNumber: v.number, backupNumber, ...revs };
  });
}

// ------------------------------------------------------------------ criação

export interface CreateInput {
  title: string;
  category?: string;
  clientId?: string | null;
  year?: number | null;
  month?: number | null;
  columns?: Column[];
  clientColumn?: string | null;
  templateId?: string;
  /** none: só a estrutura; carry: linhas com as colunas marcadas para copiar; all: cópia completa */
  copyRows?: "none" | "carry" | "all";
  rows?: RowData[];
  sourceFileId?: string | null;
  workbook?: string | null;
  importNotes?: string[];
}

const DEFAULT_COLUMNS: Column[] = [
  { id: "c1", name: "Descrição", type: "text", width: 260 },
  { id: "c2", name: "Data", type: "date", role: "date", width: 130 },
  { id: "c3", name: "Valor", type: "currency", role: "amount", width: 140 },
  { id: "c4", name: "Observações", type: "text", role: "notes", width: 240 },
];

export function createSpreadsheet(core: Core, actor: Actor, input: CreateInput, source: AuditSource = "ui"): string {
  require(actor, "edit");
  const title = input.title.replace(/\s+/g, " ").trim();
  if (!title) throw badRequest("Dê um nome para a planilha.");
  if (input.clientId && !canSeeClient(actor, input.clientId)) throw notFound("Cliente");
  if (input.clientId && !core.db.get("SELECT 1 FROM clients WHERE id = ? AND org_id = ?", [input.clientId, actor.orgId])) throw notFound("Cliente");
  if (!actor.scopeAll && !input.clientId) throw forbidden("Com acesso restrito, a planilha precisa estar vinculada a um dos seus clientes.");

  let columns = input.columns ?? DEFAULT_COLUMNS;
  let clientColumn = input.clientColumn ?? null;
  let rows: { data: RowData; clientId: string | null }[] = (input.rows ?? []).map((d) => ({ data: d, clientId: null }));
  let templateTitle: string | null = null;

  if (input.templateId) {
    const tpl = loadSheet(core, actor, input.templateId);
    templateTitle = tpl.row.title;
    columns = tpl.columns.map((c) => ({ ...c }));
    clientColumn = tpl.row.client_column;
    const mode = input.copyRows ?? "carry";
    if (mode !== "none") {
      const carry = new Set(columns.filter((c) => mode === "all" || c.carryOver).map((c) => c.id));
      const recs = readRecords(core, actor, tpl.row);
      rows = recs
        .map((r) => ({
          data: Object.fromEntries(Object.entries(r.data).filter(([k, v]) => carry.has(k) && v !== null && v !== "")),
          clientId: r.clientId,
        }))
        .filter((r) => Object.keys(r.data).length > 0);
    }
  }
  validateColumns(columns);
  if (clientColumn && !columns.some((c) => c.id === clientColumn)) clientColumn = null;
  if (rows.length > MAX_ROWS) throw badRequest(`A planilha passa do limite de ${MAX_ROWS} linhas.`);

  const id = newId("sh");
  const now = nowIso();
  core.db.tx(() => {
    core.db.run(
      `INSERT INTO spreadsheets (id, org_id, title, category, client_id, year, month, columns, client_column, source_file_id, workbook, import_notes,
                                 created_by, created_at, updated_at, updated_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        actor.orgId,
        title,
        input.category?.trim() || "Geral",
        input.clientId ?? null,
        input.year ?? null,
        input.month ?? null,
        JSON.stringify(columns),
        clientColumn,
        input.sourceFileId ?? null,
        input.workbook ?? null,
        JSON.stringify(input.importNotes ?? []),
        actor.id,
        now,
        now,
        actor.id,
      ],
    );
    let pos = 0;
    for (const r of rows) {
      pos += 1;
      const clientId = clientColumn ? r.clientId ?? resolveClientId(core, actor, r.data[clientColumn], { create: true, source }) : null;
      core.db.run(
        "INSERT INTO records (id, spreadsheet_id, position, client_id, data, created_at, created_by, updated_at, updated_by) VALUES (?,?,?,?,?,?,?,?,?)",
        [newId("rec"), id, pos, clientId, JSON.stringify(r.data), now, actor.id, now, actor.id],
      );
    }
    snapshot(core, actor, id, templateTitle ? `Criada a partir de "${templateTitle}"` : source === "import" ? "Importação" : "Criação", source);
    const clientName = input.clientId ? core.db.get<{ name: string }>("SELECT name FROM clients WHERE id = ?", [input.clientId])?.name ?? null : null;
    indexSpreadsheet(core, { id, orgId: actor.orgId, title, category: input.category?.trim() || "Geral", month: input.month ?? null, year: input.year ?? null, workbook: input.workbook ?? null, clientName });
    audit(core, actor, {
      source,
      action: source === "import" ? "spreadsheet.import" : "spreadsheet.create",
      entityType: "spreadsheet",
      entityId: id,
      spreadsheetId: id,
      clientId: input.clientId ?? null,
      summary: templateTitle
        ? `Planilha "${title}" criada a partir de "${templateTitle}" (${rows.length} linhas)`
        : `Planilha "${title}" ${source === "import" ? "importada" : "criada"} (${rows.length} linhas)`,
    });
  });
  return id;
}

export function updateSpreadsheetMeta(
  core: Core,
  actor: Actor,
  id: string,
  patch: { title?: string; category?: string; clientId?: string | null; year?: number | null; month?: number | null },
  source: AuditSource = "ui",
) {
  require(actor, "edit");
  const { row } = loadSheet(core, actor, id);
  if (!actor.scopeAll) throw forbidden("Com acesso restrito não é possível alterar os dados da planilha.");
  const title = patch.title !== undefined ? patch.title.replace(/\s+/g, " ").trim() : row.title;
  if (!title) throw badRequest("O nome não pode ficar vazio.");
  if (patch.clientId && !core.db.get("SELECT 1 FROM clients WHERE id = ? AND org_id = ?", [patch.clientId, actor.orgId])) throw notFound("Cliente");
  const next = {
    title,
    category: patch.category !== undefined ? patch.category.trim() || "Geral" : row.category,
    client_id: patch.clientId !== undefined ? patch.clientId : row.client_id,
    year: patch.year !== undefined ? patch.year : row.year,
    month: patch.month !== undefined ? patch.month : row.month,
  };
  core.db.run("UPDATE spreadsheets SET title = ?, category = ?, client_id = ?, year = ?, month = ?, updated_at = ?, updated_by = ? WHERE id = ?", [
    next.title,
    next.category,
    next.client_id,
    next.year,
    next.month,
    nowIso(),
    actor.id,
    id,
  ]);
  const clientName = next.client_id ? core.db.get<{ name: string }>("SELECT name FROM clients WHERE id = ?", [next.client_id])?.name ?? null : null;
  indexSpreadsheet(core, { id, orgId: actor.orgId, title: next.title, category: next.category, month: next.month, year: next.year, workbook: row.workbook, clientName });
  audit(core, actor, {
    source,
    action: "spreadsheet.update",
    entityType: "spreadsheet",
    entityId: id,
    spreadsheetId: id,
    clientId: next.client_id,
    summary: next.title !== row.title ? `Planilha "${row.title}" renomeada para "${next.title}"` : `Dados da planilha "${next.title}" atualizados`,
    details: { before: { title: row.title, category: row.category, clientId: row.client_id, year: row.year, month: row.month }, after: next },
  });
  emit(core, id, { type: "schema", by: actor.id, byName: actor.name, schemaRev: row.schema_rev });
}

export function deleteSpreadsheet(core: Core, actor: Actor, id: string, source: AuditSource = "ui") {
  require(actor, "delete");
  if (!actor.scopeAll) throw forbidden("Com acesso restrito não é possível excluir planilhas.");
  const { row } = loadSheet(core, actor, id);
  core.db.run("UPDATE spreadsheets SET deleted_at = ?, deleted_by = ? WHERE id = ?", [nowIso(), actor.id, id]);
  removeFromIndex(core, "spreadsheet", id);
  audit(core, actor, {
    source,
    action: "spreadsheet.delete",
    entityType: "spreadsheet",
    entityId: id,
    spreadsheetId: id,
    clientId: row.client_id,
    summary: `Planilha "${row.title}" movida para a lixeira (pode ser recuperada por ${core.cfg.trashRetentionDays} dias)`,
  });
  emit(core, id, { type: "reload", by: actor.id, byName: actor.name, reason: `${actor.name} moveu a planilha para a lixeira` });
}

export function restoreSpreadsheet(core: Core, actor: Actor, id: string) {
  require(actor, "delete");
  const { row } = loadSheet(core, actor, id, { allowDeleted: true });
  if (!row.deleted_at) return;
  core.db.run("UPDATE spreadsheets SET deleted_at = NULL, deleted_by = NULL, updated_at = ?, updated_by = ? WHERE id = ?", [nowIso(), actor.id, id]);
  const clientName = row.client_id ? core.db.get<{ name: string }>("SELECT name FROM clients WHERE id = ?", [row.client_id])?.name ?? null : null;
  indexSpreadsheet(core, { id, orgId: actor.orgId, title: row.title, category: row.category, month: row.month, year: row.year, workbook: row.workbook, clientName });
  audit(core, actor, { source: "ui", action: "spreadsheet.restore", entityType: "spreadsheet", entityId: id, spreadsheetId: id, summary: `Planilha "${row.title}" recuperada da lixeira` });
}

export function setFavorite(core: Core, actor: Actor, id: string, on: boolean) {
  loadSheet(core, actor, id);
  if (on) core.db.run("INSERT OR IGNORE INTO favorites (user_id, spreadsheet_id, created_at) VALUES (?,?,?)", [actor.id, id, nowIso()]);
  else core.db.run("DELETE FROM favorites WHERE user_id = ? AND spreadsheet_id = ?", [actor.id, id]);
}

// ------------------------------------------------------------------ colunas

function validateColumns(columns: Column[]) {
  if (!columns.length) throw badRequest("A planilha precisa de pelo menos uma coluna.");
  if (columns.length > MAX_COLUMNS) throw badRequest(`Limite de ${MAX_COLUMNS} colunas.`);
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const c of columns) {
    if (!/^[a-zA-Z0-9_]{1,24}$/.test(c.id)) throw badRequest("Identificador de coluna inválido.");
    if (ids.has(c.id)) throw badRequest("Colunas duplicadas.");
    ids.add(c.id);
    const n = normalize(c.name);
    if (!c.name.trim()) throw badRequest("Toda coluna precisa de um nome.");
    if (names.has(n)) throw badRequest(`Já existe uma coluna chamada "${c.name}".`);
    names.add(n);
  }
  // Fórmulas: referências válidas e sem ciclos entre colunas calculadas.
  const byId = new Map(columns.map((c) => [c.id, c]));
  for (const c of columns.filter((x) => x.type === "formula")) {
    if (!c.formula) throw badRequest(`A coluna calculada "${c.name}" precisa de uma fórmula.`);
    for (const ref of referencedColumns(c.formula)) if (!byId.has(ref)) throw badRequest(`A fórmula de "${c.name}" usa uma coluna que não existe.`);
  }
  const visiting = new Set<string>();
  const done = new Set<string>();
  const visit = (id: string) => {
    if (done.has(id)) return;
    if (visiting.has(id)) throw badRequest("As fórmulas formam uma referência circular.");
    visiting.add(id);
    const c = byId.get(id);
    if (c?.type === "formula" && c.formula) for (const ref of referencedColumns(c.formula)) visit(ref);
    visiting.delete(id);
    done.add(id);
  };
  for (const c of columns) visit(c.id);
}

export interface ColumnPatch {
  name?: string;
  type?: Column["type"];
  options?: string[];
  /** Fórmula no formato exibido ([Nome da coluna]) ou guardado ({id}). */
  formula?: string;
  width?: number;
  role?: Column["role"] | null;
  sensitive?: boolean;
  carryOver?: boolean;
  pendingValues?: string[];
  paidValues?: string[];
}

function applyColumnPatch(col: Column, patch: ColumnPatch, all: Column[]): Column {
  const next: Column = { ...col };
  if (patch.name !== undefined) next.name = patch.name.replace(/\s+/g, " ").trim().slice(0, 80);
  if (patch.type !== undefined) next.type = patch.type;
  if (patch.options !== undefined) next.options = [...new Set(patch.options.map((o) => o.trim()).filter(Boolean))].slice(0, 100);
  if (patch.width !== undefined) next.width = Math.max(60, Math.min(800, Math.round(patch.width)));
  if (patch.role !== undefined) next.role = patch.role ?? undefined;
  if (patch.sensitive !== undefined) next.sensitive = patch.sensitive;
  if (patch.carryOver !== undefined) next.carryOver = patch.carryOver;
  if (patch.pendingValues !== undefined) next.pendingValues = patch.pendingValues;
  if (patch.paidValues !== undefined) next.paidValues = patch.paidValues;
  if (next.type === "formula") {
    const src = patch.formula ?? next.formula ?? "";
    try {
      next.formula = toStoredFormula(src, all);
    } catch (e) {
      throw badRequest(e instanceof FormulaSyntaxError ? `Fórmula inválida: ${e.message}` : "Fórmula inválida.");
    }
  } else {
    delete next.formula;
  }
  if (next.type !== "select") delete next.options;
  return next;
}

function assertSchemaRev(row: SheetRow, expected: number | undefined) {
  if (expected !== undefined && expected !== row.schema_rev)
    throw conflict("A estrutura desta planilha foi alterada por outra pessoa. Recarregue para ver a versão atual.", { schemaRev: row.schema_rev });
}

export function addColumn(core: Core, actor: Actor, sheetId: string, input: ColumnPatch & { name: string; afterId?: string | null; schemaRev?: number }, source: AuditSource = "ui") {
  require(actor, "edit");
  if (!actor.scopeAll) throw forbidden("Com acesso restrito não é possível alterar colunas.");
  const { row, columns } = loadSheet(core, actor, sheetId);
  assertSchemaRev(row, input.schemaRev);
  const base: Column = { id: newColumnId(columns), name: input.name, type: input.type ?? "text", width: 160 };
  const col = applyColumnPatch(base, input, [...columns, base]);
  const idx = input.afterId ? columns.findIndex((c) => c.id === input.afterId) + 1 : columns.length;
  const next = [...columns];
  next.splice(idx <= 0 ? columns.length : idx, 0, col);
  validateColumns(next);
  return core.db.tx(() => {
    core.db.run("UPDATE spreadsheets SET columns = ? WHERE id = ?", [JSON.stringify(next), sheetId]);
    const revs = touch(core, actor, sheetId, "schema_rev");
    audit(core, actor, { source, action: "column.add", entityType: "spreadsheet", entityId: sheetId, spreadsheetId: sheetId, summary: `Coluna "${col.name}" adicionada em "${row.title}"` });
    emit(core, sheetId, { type: "schema", by: actor.id, byName: actor.name, schemaRev: revs.schemaRev });
    return { column: col, ...revs };
  });
}

export function updateColumn(core: Core, actor: Actor, sheetId: string, columnId: string, patch: ColumnPatch & { schemaRev?: number; clientColumn?: boolean }, source: AuditSource = "ui") {
  require(actor, "edit");
  if (!actor.scopeAll) throw forbidden("Com acesso restrito não é possível alterar colunas.");
  const { row, columns } = loadSheet(core, actor, sheetId);
  assertSchemaRev(row, patch.schemaRev);
  const idx = columns.findIndex((c) => c.id === columnId);
  if (idx < 0) throw notFound("Coluna");
  const before = columns[idx];
  const updated = applyColumnPatch(before, patch, columns);
  const next = columns.map((c, i) => (i === idx ? updated : c));
  validateColumns(next);

  return core.db.tx(() => {
    let converted = 0;
    let unconverted = 0;
    const typeChanged = before.type !== updated.type && updated.type !== "formula";
    if (typeChanged) {
      autoSnapshot(core, actor, sheetId, source);
      const recs = core.db.all<RecordRow>("SELECT id, data FROM records WHERE spreadsheet_id = ? AND deleted_at IS NULL", [sheetId]);
      for (const r of recs) {
        const data = json<RowData>(r.data, {});
        const v = data[columnId];
        if (v === null || v === undefined || isCellFormula(v)) continue;
        const c = coerceValue(updated, typeof v === "string" ? v : String(v));
        if (c.ok && c.value !== v) {
          data[columnId] = c.value;
          core.db.run("UPDATE records SET data = ?, rev = rev + 1, updated_at = ?, updated_by = ? WHERE id = ?", [JSON.stringify(data), nowIso(), actor.id, r.id]);
          converted++;
        } else if (!c.ok) unconverted++;
      }
      if (updated.type === "select") {
        // Valores existentes entram na lista de opções.
        const seen = new Set(updated.options ?? []);
        for (const r of core.db.all<{ v: string | null }>(
          "SELECT DISTINCT json_extract(data, '$.' || ?) AS v FROM records WHERE spreadsheet_id = ? AND deleted_at IS NULL",
          [columnId, sheetId],
        ))
          if (r.v !== null && r.v !== "") seen.add(String(r.v));
        updated.options = [...seen].slice(0, 100);
        next[idx] = updated;
      }
    }
    let clientColumn = row.client_column;
    if (patch.clientColumn === true) clientColumn = columnId;
    if (patch.clientColumn === false && clientColumn === columnId) clientColumn = null;
    if (patch.role === "client") clientColumn = columnId;
    core.db.run("UPDATE spreadsheets SET columns = ?, client_column = ? WHERE id = ?", [JSON.stringify(next), clientColumn, sheetId]);
    if (clientColumn !== row.client_column) relinkClients(core, actor, sheetId, clientColumn, source);
    const revs = touch(core, actor, sheetId, typeChanged || clientColumn !== row.client_column ? "both" : "schema_rev");
    const what =
      before.name !== updated.name
        ? `Coluna "${before.name}" renomeada para "${updated.name}"`
        : before.type !== updated.type
          ? `Tipo da coluna "${updated.name}" alterado`
          : `Coluna "${updated.name}" ajustada`;
    audit(core, actor, {
      source,
      action: "column.update",
      entityType: "spreadsheet",
      entityId: sheetId,
      spreadsheetId: sheetId,
      summary: `${what} em "${row.title}"`,
      details: [{ column: before.name, before, after: updated }],
    });
    emit(core, sheetId, typeChanged ? { type: "reload", by: actor.id, byName: actor.name, reason: what } : { type: "schema", by: actor.id, byName: actor.name, schemaRev: revs.schemaRev });
    return { column: next[idx], converted, unconverted, ...revs };
  });
}

function relinkClients(core: Core, actor: Actor, sheetId: string, clientColumn: string | null, source: AuditSource) {
  const recs = core.db.all<RecordRow>("SELECT id, data FROM records WHERE spreadsheet_id = ?", [sheetId]);
  for (const r of recs) {
    const cid = clientColumn ? resolveClientId(core, actor, json<RowData>(r.data, {})[clientColumn], { create: true, source }) : null;
    core.db.run("UPDATE records SET client_id = ? WHERE id = ?", [cid, r.id]);
  }
}

export function removeColumn(core: Core, actor: Actor, sheetId: string, columnId: string, schemaRev?: number, source: AuditSource = "ui") {
  require(actor, "edit");
  if (!actor.scopeAll) throw forbidden("Com acesso restrito não é possível alterar colunas.");
  const { row, columns } = loadSheet(core, actor, sheetId);
  assertSchemaRev(row, schemaRev);
  const col = columns.find((c) => c.id === columnId);
  if (!col) throw notFound("Coluna");
  const dependents = columns.filter((c) => c.type === "formula" && c.formula && referencedColumns(c.formula).includes(columnId));
  if (dependents.length) throw badRequest(`Não é possível remover: a coluna é usada na fórmula de ${dependents.map((d) => `"${d.name}"`).join(", ")}.`);
  const next = columns.filter((c) => c.id !== columnId);
  validateColumns(next);
  return core.db.tx(() => {
    snapshot(core, actor, sheetId, `Antes de remover a coluna "${col.name}"`, source);
    // Os valores ficam guardados na versão; nas linhas, a chave é removida.
    core.db.run("UPDATE records SET data = json_remove(data, '$.' || ?), rev = rev + 1 WHERE spreadsheet_id = ?", [columnId, sheetId]);
    core.db.run("UPDATE spreadsheets SET columns = ?, client_column = CASE WHEN client_column = ? THEN NULL ELSE client_column END WHERE id = ?", [
      JSON.stringify(next),
      columnId,
      sheetId,
    ]);
    if (row.client_column === columnId) core.db.run("UPDATE records SET client_id = NULL WHERE spreadsheet_id = ?", [sheetId]);
    const revs = touch(core, actor, sheetId, "both");
    audit(core, actor, { source, action: "column.remove", entityType: "spreadsheet", entityId: sheetId, spreadsheetId: sheetId, summary: `Coluna "${col.name}" removida de "${row.title}"` });
    emit(core, sheetId, { type: "reload", by: actor.id, byName: actor.name, reason: `${actor.name} removeu a coluna "${col.name}"` });
    return revs;
  });
}

export function moveColumn(core: Core, actor: Actor, sheetId: string, columnId: string, toIndex: number, schemaRev?: number) {
  require(actor, "edit");
  if (!actor.scopeAll) throw forbidden();
  const { row, columns } = loadSheet(core, actor, sheetId);
  assertSchemaRev(row, schemaRev);
  const idx = columns.findIndex((c) => c.id === columnId);
  if (idx < 0) throw notFound("Coluna");
  const next = [...columns];
  const [col] = next.splice(idx, 1);
  next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, col);
  core.db.run("UPDATE spreadsheets SET columns = ? WHERE id = ?", [JSON.stringify(next), sheetId]);
  const revs = touch(core, actor, sheetId, "schema_rev");
  emit(core, sheetId, { type: "schema", by: actor.id, byName: actor.name, schemaRev: revs.schemaRev });
  return revs;
}

// ------------------------------------------------------------------ células e linhas

function deepEqual(a: CellValue | undefined, b: CellValue | undefined): boolean {
  const na = a === undefined || a === "" ? null : a;
  const nb = b === undefined || b === "" ? null : b;
  if (typeof na === "number" && typeof nb === "number") return Math.abs(na - nb) < 1e-9;
  return na === nb;
}

function storeCellValue(col: Column, columns: Column[], raw: unknown, year?: number): CellValue {
  const c = coerceValue(col, raw, { year });
  if (!c.ok) throw badRequest(c.error);
  if (isCellFormula(c.value)) {
    try {
      return "=" + toStoredFormula(c.value, columns);
    } catch (e) {
      throw badRequest(e instanceof FormulaSyntaxError ? `Fórmula inválida: ${e.message}` : "Fórmula inválida.");
    }
  }
  return c.value;
}

export interface CellResult {
  applied: { recordId: string; columnId: string; value: CellValue; rev: number }[];
  conflicts: CellConflict[];
  dataRev: number;
}

/**
 * Aplica edições de células com controle de concorrência otimista por célula:
 * a alteração só entra se o valor no servidor ainda for o que o usuário viu.
 * Assim duas pessoas editando colunas diferentes da mesma linha não se atrapalham,
 * e ninguém sobrescreve em silêncio o trabalho do outro.
 */
export function applyCellOps(core: Core, actor: Actor, sheetId: string, ops: CellOp[], source: AuditSource = "ui", opts: { snapshotReason?: string } = {}): CellResult {
  require(actor, "edit");
  if (!ops.length) throw badRequest("Nenhuma alteração enviada.");
  if (ops.length > 5000) throw badRequest("Alterações demais de uma vez (máx. 5000 células).");
  const { row, columns } = loadSheet(core, actor, sheetId);
  const colById = new Map(columns.map((c) => [c.id, c]));

  return core.db.tx(() => {
    if (opts.snapshotReason) snapshot(core, actor, sheetId, opts.snapshotReason, source);
    else autoSnapshot(core, actor, sheetId, source);
    const applied: CellResult["applied"] = [];
    const conflicts: CellConflict[] = [];
    const details: AuditDetail[] = [];
    const byRecord = new Map<string, CellOp[]>();
    for (const op of ops) {
      const arr = byRecord.get(op.recordId) ?? [];
      arr.push(op);
      byRecord.set(op.recordId, arr);
    }
    for (const [recordId, recOps] of byRecord) {
      const rec = core.db.get<RecordRow & { updated_by_name: string | null }>(
        "SELECT r.*, u.name AS updated_by_name FROM records r LEFT JOIN users u ON u.id = r.updated_by WHERE r.id = ? AND r.spreadsheet_id = ?",
        [recordId, sheetId],
      );
      if (!rec || rec.deleted_at) {
        for (const op of recOps)
          conflicts.push({ recordId, columnId: op.columnId, current: null, attempted: op.value, byName: null, at: null });
        continue;
      }
      assertRowWritable(actor, row, rec);
      const data = json<RowData>(rec.data, {});
      let changed = false;
      let clientId = rec.client_id;
      for (const op of recOps) {
        const col = colById.get(op.columnId);
        if (!col) throw badRequest("Coluna inexistente.");
        if (col.sensitive && !can(actor, "view_sensitive")) throw forbidden(`Você não pode alterar "${col.name}".`);
        const value = storeCellValue(col, columns, op.value, row.year ?? undefined);
        const current = data[op.columnId] ?? null;
        if (!deepEqual(current, op.expected) && !deepEqual(current, value)) {
          conflicts.push({ recordId, columnId: op.columnId, current, attempted: value, byName: rec.updated_by_name, at: rec.updated_at });
          continue;
        }
        if (deepEqual(current, value)) continue;
        data[op.columnId] = value;
        changed = true;
        details.push({ recordId, column: col.name, before: current, after: value });
        if (row.client_column === op.columnId) {
          clientId = resolveClientId(core, actor, value, { create: true, source });
          if (!actor.scopeAll && (!clientId || !canSeeClient(actor, clientId))) throw forbidden("Você só pode vincular linhas aos seus clientes.");
        }
        applied.push({ recordId, columnId: op.columnId, value, rev: rec.rev + 1 });
      }
      if (changed) {
        core.db.run("UPDATE records SET data = ?, client_id = ?, rev = rev + 1, updated_at = ?, updated_by = ? WHERE id = ?", [
          JSON.stringify(data),
          clientId,
          nowIso(),
          actor.id,
          recordId,
        ]);
      }
    }
    let dataRev = row.data_rev;
    if (applied.length) {
      dataRev = touch(core, actor, sheetId, "data_rev").dataRev;
      const first = details[0];
      audit(core, actor, {
        source,
        action: "cells.update",
        entityType: "spreadsheet",
        entityId: sheetId,
        spreadsheetId: sheetId,
        clientId: clientOfFirst(core, applied[0].recordId) ?? row.client_id,
        summary:
          details.length === 1
            ? `"${first.column}" alterado em "${row.title}": ${fmtAudit(first.before)} → ${fmtAudit(first.after)}`
            : `${details.length} células alteradas em "${row.title}"`,
        details: details.slice(0, 500),
      });
      emit(core, sheetId, { type: "cells", by: actor.id, byName: actor.name, changes: applied, dataRev });
    }
    return { applied, conflicts, dataRev };
  });
}

function clientOfFirst(core: Core, recordId: string): string | null {
  return core.db.get<{ client_id: string | null }>("SELECT client_id FROM records WHERE id = ?", [recordId])?.client_id ?? null;
}

function fmtAudit(v: unknown): string {
  if (v === null || v === undefined || v === "") return "(vazio)";
  return String(v).slice(0, 60);
}

export interface InsertResult {
  created: SheetRecord[];
  dataRev: number;
  schemaRev: number;
}

export function insertRows(
  core: Core,
  actor: Actor,
  sheetId: string,
  input: { afterId?: string | null; rows: RowData[]; clientId?: string | null },
  source: AuditSource = "ui",
  opts: { snapshotReason?: string } = {},
): InsertResult {
  require(actor, "edit");
  const { row, columns } = loadSheet(core, actor, sheetId);
  if (!input.rows.length) throw badRequest("Nenhuma linha para inserir.");
  if (input.rows.length > 2000) throw badRequest("Linhas demais de uma vez (máx. 2000).");
  const total = core.db.get<{ n: number }>("SELECT COUNT(*) n FROM records WHERE spreadsheet_id = ? AND deleted_at IS NULL", [sheetId])!.n;
  if (total + input.rows.length > MAX_ROWS) throw badRequest(`Limite de ${MAX_ROWS} linhas por planilha.`);
  const colById = new Map(columns.map((c) => [c.id, c]));

  return core.db.tx((): InsertResult => {
    if (opts.snapshotReason) snapshot(core, actor, sheetId, opts.snapshotReason, source);
    else autoSnapshot(core, actor, sheetId, source);
    let start: number;
    let end: number;
    if (input.afterId) {
      const after = core.db.get<{ position: number }>("SELECT position FROM records WHERE id = ? AND spreadsheet_id = ?", [input.afterId, sheetId]);
      if (!after) throw notFound("Linha");
      const next = core.db.get<{ position: number }>(
        "SELECT position FROM records WHERE spreadsheet_id = ? AND position > ? AND deleted_at IS NULL ORDER BY position LIMIT 1",
        [sheetId, after.position],
      );
      start = after.position;
      end = next ? next.position : after.position + input.rows.length + 1;
      if ((end - start) / (input.rows.length + 1) < 1e-6) {
        renumber(core, sheetId);
        return insertRows(core, actor, sheetId, input, source, { snapshotReason: undefined });
      }
    } else {
      start = core.db.get<{ p: number | null }>("SELECT MAX(position) p FROM records WHERE spreadsheet_id = ?", [sheetId])!.p ?? 0;
      end = start + input.rows.length + 1;
    }
    const step = (end - start) / (input.rows.length + 1);
    const now = nowIso();
    const created: SheetRecord[] = [];
    input.rows.forEach((raw, i) => {
      const data: RowData = {};
      for (const [k, v] of Object.entries(raw)) {
        const col = colById.get(k);
        if (!col || col.type === "formula") continue;
        const stored = storeCellValue(col, columns, v, row.year ?? undefined);
        if (stored !== null) data[k] = stored;
      }
      let clientId: string | null = null;
      if (row.client_column) {
        if (data[row.client_column] === undefined && input.clientId) {
          const name = core.db.get<{ name: string }>("SELECT name FROM clients WHERE id = ? AND org_id = ?", [input.clientId, actor.orgId])?.name;
          if (name) data[row.client_column] = name;
        }
        clientId = resolveClientId(core, actor, data[row.client_column], { create: true, source });
      }
      if (!actor.scopeAll) {
        const ok = clientId ? canSeeClient(actor, clientId) : !row.client_column && row.client_id && canSeeClient(actor, row.client_id);
        if (!ok) throw forbidden("Você só pode inserir linhas dos seus clientes.");
      }
      const id = newId("rec");
      const position = start + step * (i + 1);
      core.db.run(
        "INSERT INTO records (id, spreadsheet_id, position, client_id, data, created_at, created_by, updated_at, updated_by) VALUES (?,?,?,?,?,?,?,?,?)",
        [id, sheetId, position, clientId, JSON.stringify(data), now, actor.id, now, actor.id],
      );
      created.push({ id, position, clientId, data, rev: 1, updatedAt: now, updatedBy: actor.id });
    });
    const revs = touch(core, actor, sheetId, "data_rev");
    const nonEmpty = created.filter((c) => Object.keys(c.data).length);
    audit(core, actor, {
      source,
      action: "rows.insert",
      entityType: "spreadsheet",
      entityId: sheetId,
      spreadsheetId: sheetId,
      clientId: created[0]?.clientId ?? row.client_id,
      summary: `${created.length === 1 ? "1 linha adicionada" : `${created.length} linhas adicionadas`} em "${row.title}"`,
      details: nonEmpty.slice(0, 200).map((c) => ({ recordId: c.id, after: c.data })),
    });
    emit(core, sheetId, { type: "rows", by: actor.id, byName: actor.name, dataRev: revs.dataRev });
    return { created, ...revs };
  });
}

function renumber(core: Core, sheetId: string) {
  const recs = core.db.all<{ id: string }>("SELECT id FROM records WHERE spreadsheet_id = ? ORDER BY position", [sheetId]);
  recs.forEach((r, i) => core.db.run("UPDATE records SET position = ? WHERE id = ?", [i + 1, r.id]));
}

export function deleteRows(core: Core, actor: Actor, sheetId: string, ids: string[], source: AuditSource = "ui", opts: { snapshotReason?: string } = {}) {
  require(actor, "edit");
  const { row, columns } = loadSheet(core, actor, sheetId);
  if (!ids.length) throw badRequest("Nenhuma linha selecionada.");
  return core.db.tx(() => {
    snapshot(core, actor, sheetId, opts.snapshotReason ?? `Antes de excluir ${ids.length === 1 ? "1 linha" : `${ids.length} linhas`}`, source);
    const now = nowIso();
    const removed: AuditDetail[] = [];
    for (const id of ids) {
      const rec = core.db.get<RecordRow>("SELECT * FROM records WHERE id = ? AND spreadsheet_id = ? AND deleted_at IS NULL", [id, sheetId]);
      if (!rec) continue;
      assertRowWritable(actor, row, rec);
      core.db.run("UPDATE records SET deleted_at = ?, updated_at = ?, updated_by = ?, rev = rev + 1 WHERE id = ?", [now, now, actor.id, id]);
      removed.push({ recordId: id, before: describeRow(columns, json<RowData>(rec.data, {})) });
    }
    if (!removed.length) throw notFound("Linha");
    const revs = touch(core, actor, sheetId, "data_rev");
    audit(core, actor, {
      source,
      action: "rows.delete",
      entityType: "spreadsheet",
      entityId: sheetId,
      spreadsheetId: sheetId,
      clientId: row.client_id,
      summary: `${removed.length === 1 ? "1 linha excluída" : `${removed.length} linhas excluídas`} de "${row.title}"`,
      details: removed,
    });
    emit(core, sheetId, { type: "rows", by: actor.id, byName: actor.name, dataRev: revs.dataRev });
    return { removed: removed.length, ...revs };
  });
}

/** Desfaz a exclusão de linhas (usado pelo "desfazer" da assistente e da interface). */
export function undeleteRows(core: Core, actor: Actor, sheetId: string, ids: string[], source: AuditSource = "ui") {
  require(actor, "edit");
  const { row } = loadSheet(core, actor, sheetId);
  return core.db.tx(() => {
    let n = 0;
    for (const id of ids) {
      const rec = core.db.get<RecordRow>("SELECT * FROM records WHERE id = ? AND spreadsheet_id = ? AND deleted_at IS NOT NULL", [id, sheetId]);
      if (!rec) continue;
      assertRowWritable(actor, row, rec);
      core.db.run("UPDATE records SET deleted_at = NULL, updated_at = ?, updated_by = ?, rev = rev + 1 WHERE id = ?", [nowIso(), actor.id, id]);
      n++;
    }
    const revs = touch(core, actor, sheetId, "data_rev");
    audit(core, actor, { source, action: "rows.restore", entityType: "spreadsheet", entityId: sheetId, spreadsheetId: sheetId, summary: `${n} linha(s) recuperada(s) em "${row.title}"` });
    emit(core, sheetId, { type: "rows", by: actor.id, byName: actor.name, dataRev: revs.dataRev });
    return { restored: n, ...revs };
  });
}

export function describeRow(columns: Column[], data: RowData): Record<string, CellValue> {
  const out: Record<string, CellValue> = {};
  for (const c of columns) if (data[c.id] !== undefined && data[c.id] !== null && data[c.id] !== "") out[c.name] = data[c.id];
  return out;
}

// ------------------------------------------------------------------ manutenção

/** Apaga definitivamente planilhas que estão na lixeira há mais tempo que o permitido. */
export function purgeTrash(core: Core) {
  const cutoff = new Date(Date.now() - core.cfg.trashRetentionDays * 86_400_000).toISOString();
  const old = core.db.all<{ id: string; org_id: string; title: string }>("SELECT id, org_id, title FROM spreadsheets WHERE deleted_at IS NOT NULL AND deleted_at < ?", [cutoff]);
  for (const s of old) {
    core.db.tx(() => {
      core.db.run("DELETE FROM spreadsheets WHERE id = ?", [s.id]);
      audit(core, null, { source: "system", action: "spreadsheet.purge", entityType: "spreadsheet", entityId: s.id, summary: `Planilha "${s.title}" apagada definitivamente após ${core.cfg.trashRetentionDays} dias na lixeira` }, s.org_id);
    });
  }
  return old.length;
}

export { FormulaError };
