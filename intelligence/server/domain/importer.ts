import ExcelJS from "exceljs";
import Papa from "papaparse";
import fs from "node:fs";
import path from "node:path";
import type { Actor, Core } from "../core.js";
import type { CellValue, Column, ColumnType, RowData } from "../../shared/types.js";
import { MONTHS_PT } from "../../shared/types.js";
import { guessRole, guessSensitive, guessStatusValues } from "../../shared/columns.js";
import { parse as parseFormula, FormulaSyntaxError, columnResolver } from "../../shared/formula.js";
import { normalize, parseNumberBR, prettyName, makeIsoDate } from "../../shared/text.js";
import { badRequest, newId, nowIso, sha256 } from "../lib/util.js";
import { require } from "./access.js";
import { createSpreadsheet } from "./spreadsheets.js";
import { audit } from "./audit.js";

// ------------------------------------------------------------------ tipos

/** Célula lida do arquivo, antes de virar valor da planilha. */
interface RawCell {
  value: CellValue | Date;
  formula?: string;
  numFmt?: string;
}

interface RawSheet {
  name: string;
  hidden: boolean;
  grid: (RawCell | null)[][];
  validations: Map<number, string[]>;
  merges: number;
  conditionalFormats: number;
}

export interface ParsedSheet {
  index: number;
  name: string;
  title: string;
  columns: Column[];
  clientColumn: string | null;
  rows: RowData[];
  month: number | null;
  year: number | null;
  notes: string[];
  stats: { rows: number; emptyRowsRemoved: number; formulasKept: number; formulasLost: number; clientsDetected: number };
  hidden: boolean;
}

export interface ParsedWorkbook {
  format: "xlsx" | "csv";
  workbook: string;
  category: string;
  sheets: ParsedSheet[];
}

// ------------------------------------------------------------------ leitura dos arquivos

const MAX_SCAN_ROWS = 25_000;
const MAX_SCAN_COLS = 150;

function excelSerialFromDate(d: Date): number {
  return (d.getTime() - Date.UTC(1899, 11, 30)) / 86_400_000;
}

function richToText(v: unknown): CellValue | Date {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") return v;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((t) => t.text).join("");
    if (typeof o.text === "string") return o.text;
    if ("error" in o) return String(o.error);
    if ("result" in o) return richToText(o.result);
  }
  return String(v);
}

async function readXlsx(buffer: Buffer): Promise<RawSheet[]> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw badRequest("Não foi possível ler o arquivo. Ele está no formato Excel (.xlsx) e sem senha?");
  }
  const out: RawSheet[] = [];
  for (const ws of wb.worksheets) {
    const grid: (RawCell | null)[][] = [];
    const maxRow = Math.min(ws.rowCount, MAX_SCAN_ROWS);
    for (let r = 1; r <= maxRow; r++) {
      const row = ws.getRow(r);
      const cells: (RawCell | null)[] = [];
      const maxCol = Math.min(row.cellCount, MAX_SCAN_COLS);
      for (let c = 1; c <= maxCol; c++) {
        const cell = row.getCell(c);
        if (cell.value === null || cell.value === undefined) {
          cells.push(null);
          continue;
        }
        const formula = cell.type === ExcelJS.ValueType.Formula ? cell.formula : undefined;
        let value = richToText(cell.value);
        if (value instanceof Date && (Number.isNaN(value.getTime()) || value.getUTCFullYear() > 2200 || value.getUTCFullYear() < 1900))
          value = Math.round(excelSerialFromDate(value) * 1e6) / 1e6;
        cells.push({ value, formula, numFmt: cell.numFmt });
      }
      grid.push(cells);
    }
    const validations = new Map<number, string[]>();
    const model = (ws as unknown as { dataValidations?: { model?: Record<string, { type?: string; formulae?: string[] }> } }).dataValidations?.model ?? {};
    for (const [addr, dv] of Object.entries(model)) {
      if (dv?.type !== "list" || !dv.formulae?.[0]) continue;
      const f = dv.formulae[0];
      if (!f.startsWith('"')) continue; // listas que apontam para intervalos não são suportadas
      const options = f.replace(/^"|"$/g, "").split(",").map((s) => s.trim()).filter(Boolean);
      for (const part of addr.split(/\s+/)) {
        const m = part.match(/^([A-Z]+)\d+(?::([A-Z]+)\d+)?$/);
        if (!m) continue;
        const from = colIndex(m[1]);
        const to = m[2] ? colIndex(m[2]) : from;
        for (let ci = from; ci <= to; ci++) validations.set(ci, [...new Set([...(validations.get(ci) ?? []), ...options])]);
      }
    }
    const merges = Object.keys((ws as unknown as { _merges?: Record<string, unknown> })._merges ?? {}).length;
    const cf = ((ws as unknown as { conditionalFormattings?: unknown[] }).conditionalFormattings ?? []).length;
    out.push({ name: ws.name, hidden: ws.state !== "visible", grid, validations, merges, conditionalFormats: cf });
  }
  return out;
}

function decodeText(buffer: Buffer): string {
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(buffer).replace(/^﻿/, "");
  if (!utf8.includes("�")) return utf8;
  // Excel em português costuma exportar CSV em Windows-1252.
  return new TextDecoder("windows-1252").decode(buffer);
}

function readCsv(buffer: Buffer, name: string): RawSheet[] {
  const text = decodeText(buffer);
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: false, delimiter: "" });
  if (parsed.errors.length && !parsed.data.length) throw badRequest("Não foi possível ler o CSV.");
  const grid = parsed.data.slice(0, MAX_SCAN_ROWS).map((r) => r.slice(0, MAX_SCAN_COLS).map((v) => (v === "" ? null : { value: v as CellValue })));
  return [{ name: name.replace(/\.[^.]+$/, ""), hidden: false, grid, validations: new Map(), merges: 0, conditionalFormats: 0 }];
}

// ------------------------------------------------------------------ análise

export function colLetter(index: number): string {
  let s = "";
  let n = index + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function isBlank(c: RawCell | null | undefined): boolean {
  return !c || c.value === null || (typeof c.value === "string" && c.value.trim() === "");
}

function detectHeader(grid: (RawCell | null)[][]): number {
  let best = -1;
  for (let r = 0; r < Math.min(grid.length, 15); r++) {
    const cells = grid[r].filter((c) => !isBlank(c));
    if (cells.length < 2) continue;
    const texts = cells.filter((c) => typeof c!.value === "string" && !c!.formula && parseNumberBR(c!.value) === null);
    if (texts.length / cells.length >= 0.6) {
      best = r;
      break;
    }
  }
  return best < 0 ? 0 : best;
}

const MONEY_HEADER = /\b(vr|valor|total|pgto|pagamento|preco|salario|r)\b/;

function guessMonthYear(sheetName: string, fileName: string): { month: number | null; year: number | null } {
  const n = normalize(sheetName);
  let month: number | null = null;
  MONTHS_PT.forEach((m, i) => {
    const key = normalize(m);
    if (new RegExp(`\\b(${key}|${key.slice(0, 3)})\\b`).test(n)) month = month ?? i + 1;
  });
  const y = (sheetName.match(/\b(20\d{2})\b/) ?? fileName.match(/\b(20\d{2})\b/))?.[1];
  return { month, year: y ? Number(y) : null };
}

/**
 * Converte uma fórmula do Excel da linha `row` para o formato próprio, quando ela só
 * usa células da mesma linha (o padrão das planilhas da Cuidare). Senão, devolve null.
 */
export function translateExcelFormula(formula: string, row: number, letterToId: (letter: string) => string | null, columns: Column[]): string | null {
  if (/!|:|\[|\{/.test(formula)) return null; // outras abas, intervalos ou referências estruturadas
  let ok = true;
  const out = formula.replace(/(?<![A-Za-z_])\$?([A-Z]{1,3})\$?(\d+)(?![\d(])/g, (_m, letters: string, rowStr: string) => {
    if (Number(rowStr) !== row) {
      ok = false;
      return _m;
    }
    const id = letterToId(letters);
    if (!id) {
      ok = false;
      return _m;
    }
    return `{${id}}`;
  });
  if (!ok) return null;
  try {
    parseFormula(out, columnResolver(columns));
    return out;
  } catch (e) {
    if (e instanceof FormulaSyntaxError) return null;
    throw e;
  }
}

function toIsoFromDate(d: Date): string | null {
  return makeIsoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

function analyzeSheet(raw: RawSheet, index: number, fileName: string): ParsedSheet {
  const notes: string[] = [];
  const grid = raw.grid;
  const headerRow = detectHeader(grid);
  const header = grid[headerRow] ?? [];
  let lastRow = grid.length - 1;
  while (lastRow > headerRow && (grid[lastRow] ?? []).every(isBlank)) lastRow--;

  // Colunas: até a última coluna com cabeçalho ou dado.
  let width = header.length;
  for (let r = headerRow + 1; r <= lastRow; r++) {
    const row = grid[r] ?? [];
    for (let c = row.length - 1; c >= width; c--)
      if (!isBlank(row[c])) {
        width = c + 1;
        break;
      }
  }
  while (width > 0 && isBlank(header[width - 1]) && grid.slice(headerRow + 1, lastRow + 1).every((row) => isBlank(row?.[width - 1]))) width--;

  const columns: Column[] = [];
  const used = new Map<string, number>();
  for (let c = 0; c < width; c++) {
    const h = header[c];
    let name = !isBlank(h) ? String(h!.value).replace(/\s+/g, " ").trim() : `Coluna ${colLetter(c)}`;
    if (name.length > 80) name = name.slice(0, 80);
    const key = normalize(name);
    const n = (used.get(key) ?? 0) + 1;
    used.set(key, n);
    if (n > 1) name = `${name} (${n})`;
    columns.push({ id: `c${c + 1}`, name, type: "text", width: 150 });
  }
  if (!columns.length) {
    return {
      index,
      name: raw.name,
      title: prettyName(raw.name),
      columns: [{ id: "c1", name: "Coluna A", type: "text", width: 160 }],
      clientColumn: null,
      rows: [],
      ...guessMonthYear(raw.name, fileName),
      notes: ["A aba está vazia."],
      stats: { rows: 0, emptyRowsRemoved: 0, formulasKept: 0, formulasLost: 0, clientsDetected: 0 },
      hidden: raw.hidden,
    };
  }
  const letterToId = (letters: string) => {
    const i = colIndex(letters);
    return i >= 0 && i < columns.length ? columns[i].id : null;
  };

  // Linhas de dados.
  type Pending = { r: number; cells: (RawCell | null)[] };
  const dataRows: Pending[] = [];
  let emptyRemoved = 0;
  for (let r = headerRow + 1; r <= lastRow; r++) {
    const cells = (grid[r] ?? []).slice(0, width);
    if (cells.every(isBlank)) {
      emptyRemoved++;
      continue;
    }
    dataRows.push({ r, cells });
  }

  // Inferência de tipo por coluna.
  const lostFormulas: string[] = [];
  let kept = 0;
  const formulaByCol = new Map<number, Map<string, number>>();
  const DASH = /^[-–—.]+$/;
  const keptTexts = new Map<number, string[]>();
  for (let c = 0; c < columns.length; c++) {
    const col = columns[c];
    let nums = 0;
    let numericTexts = 0;
    let dashes = 0;
    const otherTexts: string[] = [];
    let dates = 0;
    let bools = 0;
    let moneyFmt = false;
    for (const { cells } of dataRows) {
      const cell = cells[c];
      if (isBlank(cell) || cell!.formula) continue;
      const v = cell!.value;
      if (v instanceof Date) dates++;
      else if (typeof v === "number") nums++;
      else if (typeof v === "boolean") bools++;
      else {
        const t = String(v).trim();
        if (DASH.test(t)) dashes++;
        else if (parseNumberBR(t) !== null) {
          numericTexts++;
          if (/r\$/i.test(t)) moneyFmt = true;
        } else otherTexts.push(t);
      }
      if (cell!.numFmt && /R\$|\[\$R\$/.test(cell!.numFmt)) moneyFmt = true;
    }
    const role = guessRole(col.name);
    const sensitive = guessSensitive(col.name);
    const options = raw.validations.get(c);
    const numericTotal = nums + numericTexts;
    const filled = numericTotal + otherTexts.length + dates + bools;
    const mostlyNumeric = numericTotal > 0 && otherTexts.length <= Math.max(3, filled * 0.05) && dates <= Math.max(1, filled * 0.02);
    const wantsNumber = ["quantity", "absences", "amount", "unit_value"].includes(role ?? "") || MONEY_HEADER.test(normalize(col.name));
    let type: ColumnType = "text";
    // Lista de validação só vale se os dados realmente forem opções (e não números).
    const optionsApply = !!options?.length && !(mostlyNumeric && numericTotal >= 5);
    if (sensitive) type = "text";
    else if (optionsApply) type = "select";
    else if (dates && !numericTotal && !otherTexts.length) type = "date";
    else if (mostlyNumeric && (numericTexts === 0 || wantsNumber || numericTotal >= filled * 0.9))
      type = moneyFmt || (MONEY_HEADER.test(normalize(col.name)) && role !== "quantity" && role !== "absences") ? "currency" : "number";
    else if (bools && !numericTotal && !otherTexts.length && !dates) type = "boolean";
    if ((role === "payment_date" || role === "date") && dates && !otherTexts.length && !numericTotal) type = "date";
    if (!filled && !dashes && !optionsApply && !sensitive) {
      // Coluna vazia: o tipo vem do nome/papel.
      if (role === "payment_date" || role === "date") type = "date";
      else if (role === "quantity" || role === "absences") type = "number";
      else if (wantsNumber) type = "currency";
    }
    if (type === "number" || type === "currency") {
      if (otherTexts.length) {
        keptTexts.set(c, otherTexts);
        notes.push(`"${col.name}": ${otherTexts.length} valor(es) que não são números foram mantidos como texto (ex.: "${otherTexts[0].slice(0, 30)}"); eles ficam fora das somas.`);
      }
      if (numericTexts) notes.push(`"${col.name}": ${numericTexts} valor(es) digitados como texto (ex.: "R$ 350,00") foram convertidos em número.`);
      if (dashes) notes.push(`"${col.name}": ${dashes} traço(s) "-" foram tratados como vazio.`);
    } else if (numericTotal >= 3 && otherTexts.length >= 3 && !optionsApply && !sensitive && Math.min(numericTotal, otherTexts.length) >= filled * 0.05)
      notes.push(`A coluna "${col.name}" mistura números e textos; foi importada como texto.`);
    col.type = type;
    if (role) col.role = role;
    if (sensitive) col.sensitive = true;
    if (type === "select") {
      const seen = new Set(options ?? []);
      for (const { cells } of dataRows) {
        const v = cells[c]?.value;
        if (typeof v === "string" && v.trim() && !cells[c]?.formula) seen.add(v.trim());
      }
      col.options = [...seen].slice(0, 100);
      // Lista com PAGO/PENDENTE é a situação do pagamento, mesmo que o cabeçalho diga outra coisa.
      const g = guessStatusValues(col.options);
      if ((g.pending.length && g.paid.length) || ((g.pending.length || g.paid.length) && (col.role === "status" || /pag|pgto/.test(normalize(col.name))))) {
        col.role = "status";
        col.pendingValues = g.pending;
        col.paidValues = g.paid;
      }
    }
    col.width = Math.max(110, Math.min(320, col.name.length * 9 + 40));
  }

  // Cada papel fica em uma coluna só (a primeira); o de cliente é decidido abaixo.
  const seenRoles = new Set<string>();
  for (const col of columns) {
    if (!col.role || col.role === "notes" || col.role === "client") continue;
    if (seenRoles.has(col.role)) delete col.role;
    else seenRoles.add(col.role);
  }
  for (const col of columns) col.carryOver = ["client", "worker", "regime", "shift", "unit_value"].includes(col.role ?? "") || !!col.sensitive;

  // Valores e fórmulas.
  const rows: RowData[] = [];
  for (const { r, cells } of dataRows) {
    const data: RowData = {};
    for (let c = 0; c < columns.length; c++) {
      const cell = cells[c];
      if (isBlank(cell)) continue;
      const col = columns[c];
      if (cell!.formula) {
        const translated = translateExcelFormula(cell!.formula, r + 1, letterToId, columns);
        if (translated) {
          data[col.id] = "=" + translated;
          kept++;
          const m = formulaByCol.get(c) ?? new Map<string, number>();
          m.set(translated, (m.get(translated) ?? 0) + 1);
          formulaByCol.set(c, m);
          continue;
        }
        lostFormulas.push(`${colLetter(c)}${r + 1}`);
        const v = cell!.value;
        data[col.id] = v instanceof Date ? toIsoFromDate(v) : (v as CellValue);
        continue;
      }
      const v = cell!.value;
      if (v instanceof Date) data[col.id] = toIsoFromDate(v);
      else if (col.sensitive && typeof v === "number") data[col.id] = String(v);
      else if (typeof v === "string") {
        const t = v.trim();
        if (col.type === "number" || col.type === "currency") {
          if (DASH.test(t)) continue;
          const n = parseNumberBR(t);
          data[col.id] = n ?? t;
        } else data[col.id] = t;
      } else data[col.id] = v;
    }
    rows.push(data);
  }

  // Coluna inteira com a mesma fórmula → vira coluna calculada.
  for (const [c, patterns] of formulaByCol) {
    const col = columns[c];
    const [[expr, count]] = [...patterns.entries()].sort((a, b) => b[1] - a[1]);
    const literals = rows.filter((d) => d[col.id] !== undefined && d[col.id] !== "=" + expr).length;
    if (patterns.size === 1 && literals === 0 && count >= Math.max(2, rows.length * 0.9)) {
      col.type = "formula";
      col.formula = expr;
      col.carryOver = false;
      for (const d of rows) delete d[col.id];
      notes.push(`"${col.name}" virou coluna calculada: ${expr.replace(/\{(c\d+)\}/g, (_, id) => `[${columns.find((x) => x.id === id)?.name}]`)}.`);
    } else if (col.type === "text" && rows.every((d) => d[col.id] === undefined || (typeof d[col.id] === "string" && String(d[col.id]).startsWith("=")) || typeof d[col.id] === "number")) {
      col.type = MONEY_HEADER.test(normalize(col.name)) ? "currency" : "number";
    }
  }

  if (lostFormulas.length)
    notes.push(
      `${lostFormulas.length} fórmula(s) usam outras abas ou intervalos (${lostFormulas.slice(0, 6).join(", ")}${lostFormulas.length > 6 ? "…" : ""}) e não puderam ser mantidas: foi importado o último valor calculado pelo Excel.`,
    );
  if (raw.merges) notes.push(`${raw.merges} grupo(s) de células mescladas foram separados.`);
  if (raw.conditionalFormats) notes.push("A formatação condicional (cores automáticas) não foi mantida.");
  if (emptyRemoved) notes.push(`${emptyRemoved} linha(s) totalmente vazia(s) foram ignoradas.`);
  if (raw.hidden) notes.push("Esta aba estava oculta no arquivo original.");
  if (headerRow > 0) notes.push(`O cabeçalho foi encontrado na linha ${headerRow + 1}.`);

  // Coluna de cliente: prioriza "Assistido".
  const clientCol =
    columns.find((c) => c.role === "client" && /^assist/.test(normalize(c.name))) ?? columns.find((c) => c.role === "client") ?? null;
  for (const c of columns) if (c.role === "client" && c !== clientCol) delete c.role;
  const clients = new Set<string>();
  if (clientCol) for (const d of rows) if (typeof d[clientCol.id] === "string") clients.add(normalize(String(d[clientCol.id])));

  const errorCells = rows.reduce((n, d) => n + Object.values(d).filter((v) => typeof v === "string" && /^#(VALUE|REF|DIV\/0|NAME|N\/A)!?\??$/.test(v)).length, 0);
  if (errorCells) notes.push(`${errorCells} célula(s) já estavam com erro no Excel (#VALUE!, #REF!…).`);

  const { month, year } = guessMonthYear(raw.name, fileName);
  return {
    index,
    name: raw.name,
    title: prettyName(raw.name),
    columns,
    clientColumn: clientCol?.id ?? null,
    rows,
    month,
    year,
    notes,
    stats: { rows: rows.length, emptyRowsRemoved: emptyRemoved, formulasKept: kept, formulasLost: lostFormulas.length, clientsDetected: clients.size },
    hidden: raw.hidden,
  };
}

function workbookName(fileName: string): string {
  return prettyName(
    fileName
      .replace(/\.[^.]+$/, "")
      .replace(/[_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function guessCategory(name: string): string {
  const n = normalize(name);
  if (/pagament|pgto|financ|fechamento/.test(n)) return "Controle de pagamentos";
  if (/atendiment/.test(n)) return "Atendimentos";
  if (/escala|plantao/.test(n)) return "Escalas";
  return name.replace(/\s*\d+$/, "") || "Geral";
}

export async function parseWorkbook(buffer: Buffer, fileName: string): Promise<ParsedWorkbook> {
  const ext = path.extname(fileName).toLowerCase();
  let format: "xlsx" | "csv";
  let raws: RawSheet[];
  if (ext === ".xlsx" || ext === ".xlsm") {
    if (buffer.subarray(0, 2).toString() !== "PK") throw badRequest("O arquivo não parece ser um Excel válido.");
    format = "xlsx";
    raws = await readXlsx(buffer);
  } else if (ext === ".csv" || ext === ".txt") {
    format = "csv";
    raws = readCsv(buffer, fileName);
  } else if (ext === ".xls") {
    throw badRequest('Arquivos .xls (Excel 97-2003) não são suportados. Abra no Excel e use "Salvar como" → .xlsx.');
  } else {
    throw badRequest("Envie um arquivo Excel (.xlsx) ou CSV.");
  }
  const wbName = workbookName(fileName);
  return {
    format,
    workbook: wbName,
    category: guessCategory(wbName),
    sheets: raws.map((r, i) => analyzeSheet(r, i, fileName)),
  };
}

// ------------------------------------------------------------------ armazenamento e confirmação

const MIME: Record<string, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
};

export async function storeUpload(core: Core, actor: Actor, buffer: Buffer, originalName: string) {
  require(actor, "import");
  if (buffer.length > core.cfg.maxUploadMb * 1024 * 1024) throw badRequest(`O arquivo passa do limite de ${core.cfg.maxUploadMb} MB.`);
  const safeName = path.basename(originalName).replace(/[^\p{L}\p{N} ._()-]/gu, "_").slice(0, 150) || "arquivo";
  const parsed = await parseWorkbook(buffer, safeName);
  const hash = sha256(buffer);
  const id = newId("fil");
  const key = `${id}${path.extname(safeName).toLowerCase()}`;
  fs.writeFileSync(path.join(core.paths.files, key), buffer, { mode: 0o600 });
  core.db.run("INSERT INTO files (id, org_id, original_name, mime, format, size, sha256, storage_key, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)", [
    id,
    actor.orgId,
    safeName,
    MIME[parsed.format],
    parsed.format,
    buffer.length,
    hash,
    key,
    actor.id,
    nowIso(),
  ]);
  const duplicate = core.db.get<{ title: string }>(
    "SELECT s.title FROM spreadsheets s JOIN files f ON f.id = s.source_file_id WHERE f.sha256 = ? AND f.org_id = ? AND s.deleted_at IS NULL LIMIT 1",
    [hash, actor.orgId],
  );
  return { fileId: id, parsed, duplicateOf: duplicate?.title ?? null };
}

export function previewOf(parsed: ParsedWorkbook) {
  return {
    format: parsed.format,
    workbook: parsed.workbook,
    category: parsed.category,
    sheets: parsed.sheets.map((s) => ({
      index: s.index,
      name: s.name,
      title: s.title,
      month: s.month,
      year: s.year,
      hidden: s.hidden,
      columns: s.columns,
      clientColumn: s.clientColumn,
      notes: s.notes,
      stats: s.stats,
      sample: s.rows.slice(0, 8),
    })),
  };
}

export interface CommitChoice {
  index: number;
  include: boolean;
  title: string;
  year: number | null;
  month: number | null;
  clientColumn: string | null;
  clientId: string | null;
}

export async function commitImport(core: Core, actor: Actor, fileId: string, input: { category: string; sheets: CommitChoice[] }) {
  require(actor, "import");
  const file = core.db.get<{ id: string; storage_key: string; original_name: string; org_id: string }>("SELECT * FROM files WHERE id = ? AND org_id = ?", [
    fileId,
    actor.orgId,
  ]);
  if (!file) throw badRequest("Arquivo não encontrado. Envie novamente.");
  const parsed = await parseWorkbook(fs.readFileSync(path.join(core.paths.files, file.storage_key)), file.original_name);
  const chosen = input.sheets.filter((s) => s.include);
  if (!chosen.length) throw badRequest("Escolha pelo menos uma aba para importar.");
  const created: { id: string; title: string; rows: number }[] = [];
  core.db.tx(() => {
    for (const choice of chosen) {
      const sheet = parsed.sheets.find((s) => s.index === choice.index);
      if (!sheet) continue;
      const clientColumn = choice.clientColumn && sheet.columns.some((c) => c.id === choice.clientColumn) ? choice.clientColumn : null;
      const columns = sheet.columns.map((c) => {
        const copy = { ...c };
        if (c.id === clientColumn) copy.role = "client";
        else if (c.role === "client") delete copy.role;
        return copy;
      });
      const id = createSpreadsheet(
        core,
        actor,
        {
          title: choice.title || sheet.title,
          category: input.category || parsed.category,
          clientId: choice.clientId,
          year: choice.year,
          month: choice.month,
          columns,
          clientColumn,
          rows: sheet.rows,
          sourceFileId: file.id,
          workbook: parsed.workbook,
          importNotes: sheet.notes,
        },
        "import",
      );
      created.push({ id, title: choice.title || sheet.title, rows: sheet.rows.length });
    }
    audit(core, actor, {
      source: "import",
      action: "file.import",
      entityType: "file",
      entityId: file.id,
      summary: `Arquivo "${file.original_name}" importado: ${created.length} planilha(s), ${created.reduce((n, c) => n + c.rows, 0)} linhas`,
    });
  });
  return created;
}

export function readStoredFile(core: Core, actor: Actor, fileId: string) {
  const f = core.db.get<{ storage_key: string; original_name: string; mime: string }>("SELECT * FROM files WHERE id = ? AND org_id = ?", [fileId, actor.orgId]);
  if (!f) return null;
  const linked = core.db.all<{ id: string }>("SELECT id FROM spreadsheets WHERE source_file_id = ? AND deleted_at IS NULL", [fileId]);
  return { path: path.join(core.paths.files, f.storage_key), name: f.original_name, mime: f.mime, sheetIds: linked.map((l) => l.id) };
}
