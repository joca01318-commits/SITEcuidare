import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import type { Actor, Core } from "../core.js";
import type { Column } from "../../shared/types.js";
import { formatCell, isNumericColumn } from "../../shared/columns.js";
import { FormulaError, isCellFormula, type Value } from "../../shared/formula.js";
import { formatMoney, formatNumber, normalize } from "../../shared/text.js";
import { audit } from "./audit.js";
import { can, maskSensitive, require } from "./access.js";
import { computeRecords, getSpreadsheet, periodLabel, totalsFor, type ComputedRow } from "./spreadsheets.js";
import { colLetter } from "./importer.js";

export interface ExportInput {
  format: "xlsx" | "pdf";
  recordIds?: string[];
  clientId?: string | null;
  filterLabel?: string | null;
  columnIds?: string[];
}

const FN_TO_EXCEL: Record<string, string> = {
  SOMA: "SUM",
  MEDIA: "AVERAGE",
  MINIMO: "MIN",
  MAXIMO: "MAX",
  ARRED: "ROUND",
  ARREDONDAR: "ROUND",
  INTEIRO: "INT",
  SE: "IF",
  SEERRO: "IFERROR",
  E: "AND",
  OU: "OR",
  NAO: "NOT",
  CONCATENAR: "CONCAT",
  MAIUSCULA: "UPPER",
  MINUSCULA: "LOWER",
  "ECEL.VAZIA": "ISBLANK",
  HOJE: "TODAY",
  VERDADEIRO: "TRUE",
  FALSO: "FALSE",
};

/** Converte "{c5}*{c6}" na fórmula do Excel da linha `row` ("E5*F5"). */
function toExcelFormula(stored: string, row: number, letterOf: Map<string, string>): string | null {
  let ok = true;
  const withRefs = stored.replace(/^=/, "").replace(/\{([^}]+)\}/g, (_, id: string) => {
    const l = letterOf.get(id);
    if (!l) ok = false;
    return `${l}${row}`;
  });
  if (!ok) return null;
  // Troca nomes de funções em português pelos nomes que o arquivo .xlsx exige (fora de textos entre aspas).
  return withRefs
    .split(/("(?:[^"]|"")*")/)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(/[\p{L}_][\p{L}\p{N}_.]*(?=\s*\()/gu, (name) => FN_TO_EXCEL[normalize(name).replace(/ /g, ".").toUpperCase()] ?? name.toUpperCase()),
    )
    .join("");
}

function excelValue(v: Value): string | number | boolean | Date | null {
  if (v instanceof FormulaError) return v.code;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(v + "T00:00:00Z");
  return v;
}

function prepare(core: Core, actor: Actor, sheetId: string, input: ExportInput) {
  require(actor, "export");
  const detail = getSpreadsheet(core, actor, sheetId, { clientId: input.clientId ?? null, track: false });
  let records = detail.records;
  if (input.recordIds?.length) {
    const order = new Map(input.recordIds.map((id, i) => [id, i]));
    records = records.filter((r) => order.has(r.id)).sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  }
  let columns = detail.columns;
  if (input.columnIds?.length) {
    const keep = new Set(input.columnIds);
    // Colunas usadas por fórmulas continuam no cálculo mesmo se ocultas na exportação.
    columns = detail.columns.filter((c) => keep.has(c.id));
  }
  const computed = computeRecords(detail.columns, records);
  const clientName = input.clientId
    ? core.db.get<{ name: string }>("SELECT name FROM clients WHERE id = ?", [input.clientId])?.name ?? null
    : detail.clientName;
  return { detail, columns, computed, clientName };
}

function subtitleParts(actor: Actor, detail: { month: number | null; year: number | null; category: string }, clientName: string | null, filterLabel?: string | null) {
  const parts = [detail.category];
  if (clientName) parts.push(`Cliente: ${clientName}`);
  const period = periodLabel(detail.month, detail.year);
  if (period) parts.push(`Período: ${period}`);
  if (filterLabel) parts.push(`Filtro: ${filterLabel}`);
  const now = new Date();
  parts.push(`Exportado em ${now.toLocaleDateString("pt-BR")} às ${now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} por ${actor.name}`);
  return parts;
}

function safeSheetName(s: string) {
  return s.replace(/[[\]:*?/\\]/g, " ").slice(0, 31) || "Planilha";
}

export function fileBaseName(title: string, clientName: string | null) {
  return `${title}${clientName ? " - " + clientName : ""}`.replace(/[^\p{L}\p{N} ._()-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 120) || "planilha";
}

export async function exportXlsx(core: Core, actor: Actor, sheetId: string, input: ExportInput): Promise<{ buffer: Buffer; filename: string }> {
  const { detail, columns, computed, clientName } = prepare(core, actor, sheetId, input);
  const wb = new ExcelJS.Workbook();
  wb.creator = "Cuidare Intelligence";
  wb.created = new Date();
  const ws = wb.addWorksheet(safeSheetName(detail.title), { views: [{ state: "frozen", ySplit: 4 }] });
  const showSensitive = can(actor, "view_sensitive");

  ws.getCell("A1").value = detail.title;
  ws.getCell("A1").font = { bold: true, size: 14, color: { argb: "FF0B2E4A" } };
  ws.getCell("A2").value = subtitleParts(actor, detail, clientName, input.filterLabel).join("  ·  ");
  ws.getCell("A2").font = { size: 9, color: { argb: "FF50697E" } };

  const HEADER = 4;
  const letterOf = new Map<string, string>();
  columns.forEach((c, i) => letterOf.set(c.id, colLetter(i)));
  const headerRow = ws.getRow(HEADER);
  columns.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = c.name;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF093457" } };
    cell.alignment = { vertical: "middle", wrapText: true };
    ws.getColumn(i + 1).width = Math.max(8, Math.min(60, (c.width ?? 150) / 7));
  });
  headerRow.height = 22;

  const first = HEADER + 1;
  computed.forEach((row, ri) => {
    const excelRow = first + ri;
    const r = ws.getRow(excelRow);
    columns.forEach((c, ci) => {
      const cell = r.getCell(ci + 1);
      const value = row.values[c.id];
      const raw = row.record.data[c.id];
      const stored = c.type === "formula" ? c.formula : isCellFormula(raw) ? raw : null;
      const formula = stored ? toExcelFormula(stored, excelRow, letterOf) : null;
      const result = excelValue(value);
      if (c.sensitive && !showSensitive) cell.value = maskSensitive(raw);
      else if (formula) cell.value = { formula, result: result instanceof Date ? undefined : (result as never) };
      else cell.value = result;
      if (c.type === "currency" || (c.type === "formula" && /vr|valor|total|pgto/i.test(c.name))) cell.numFmt = '"R$" #,##0.00';
      else if (c.type === "date") cell.numFmt = "dd/mm/yyyy";
      cell.alignment = { vertical: "top", wrapText: c.type === "text" };
      if (ri % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F8FB" } };
    });
  });
  const last = first + computed.length - 1;

  // Listas suspensas preservadas.
  columns.forEach((c, i) => {
    if (c.type === "select" && c.options?.length && computed.length) {
      const list = `"${c.options.join(",").replace(/"/g, "'")}"`;
      if (list.length <= 255) {
        for (let r = first; r <= last; r++)
          ws.getCell(r, i + 1).dataValidation = { type: "list", allowBlank: true, formulae: [list], showErrorMessage: false };
      }
    }
  });

  // Linha de totais com fórmulas reais.
  const totals = totalsFor(columns, computed);
  if (totals.length && computed.length) {
    const tr = ws.getRow(last + 2);
    tr.getCell(1).value = "Total";
    tr.getCell(1).font = { bold: true };
    for (const t of totals) {
      const idx = columns.findIndex((c) => c.id === t.columnId);
      if (idx === 0) continue;
      const l = colLetter(idx);
      const cell = tr.getCell(idx + 1);
      cell.value = { formula: `SUM(${l}${first}:${l}${last})`, result: t.sum };
      cell.font = { bold: true };
      if (t.currency) cell.numFmt = '"R$" #,##0.00';
    }
  }
  if (computed.length) ws.autoFilter = { from: { row: HEADER, column: 1 }, to: { row: last, column: columns.length } };

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  logExport(core, actor, detail.id, detail.title, "Excel", computed.length, clientName);
  return { buffer, filename: `${fileBaseName(detail.title, clientName)}.xlsx` };
}

function logExport(core: Core, actor: Actor, sheetId: string, title: string, fmt: string, rows: number, clientName: string | null) {
  audit(core, actor, {
    source: "ui",
    action: "spreadsheet.export",
    entityType: "spreadsheet",
    entityId: sheetId,
    spreadsheetId: sheetId,
    summary: `"${title}"${clientName ? ` (${clientName})` : ""} exportada em ${fmt} — ${rows} linhas`,
  });
}

// ------------------------------------------------------------------ PDF

const INK = "#0b2e4a";
const MUTED = "#50697e";
const LINE = "#d9e2ea";
const BRAND = "#093457";

function cellText(c: Column, row: ComputedRow, showSensitive: boolean): string {
  if (c.sensitive && !showSensitive) return maskSensitive(row.record.data[c.id]) ?? "";
  return formatCell(c, row.values[c.id]);
}

export async function exportPdf(core: Core, actor: Actor, sheetId: string, input: ExportInput): Promise<{ buffer: Buffer; filename: string }> {
  const { detail, columns, computed, clientName } = prepare(core, actor, sheetId, input);
  const showSensitive = can(actor, "view_sensitive");
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 32, bufferPages: true, info: { Title: detail.title, Author: "Cuidare Intelligence" } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve) => doc.on("end", () => resolve()));

  const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const fontSize = columns.length > 14 ? 6.5 : columns.length > 10 ? 7.5 : 8.5;
  const pad = 3;

  // Larguras proporcionais ao conteúdo.
  doc.font("Helvetica").fontSize(fontSize);
  const natural = columns.map((c) => {
    let w = doc.font("Helvetica-Bold").widthOfString(c.name);
    doc.font("Helvetica");
    for (const r of computed.slice(0, 300)) w = Math.max(w, Math.min(doc.widthOfString(cellText(c, r, showSensitive)), 220));
    return Math.max(w + pad * 2, 34);
  });
  const sum = natural.reduce((a, b) => a + b, 0);
  const widths = natural.map((w) => (w / sum) * pageW);

  const header = () => {
    doc.fillColor(BRAND).font("Helvetica-Bold").fontSize(8).text("CUIDARE INTELLIGENCE", doc.page.margins.left, 24, { characterSpacing: 1 });
    doc.moveDown(0.3);
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(16).text(detail.title);
    doc.fillColor(MUTED).font("Helvetica").fontSize(8.5).text(subtitleParts(actor, detail, clientName, input.filterLabel).join("   ·   "));
    doc.moveDown(0.6);
  };

  const tableHeader = (y: number) => {
    doc.font("Helvetica-Bold").fontSize(fontSize);
    const h = Math.max(...columns.map((c, i) => doc.heightOfString(c.name, { width: widths[i] - pad * 2 }))) + pad * 2;
    doc.rect(doc.page.margins.left, y, pageW, h).fill(BRAND);
    let x = doc.page.margins.left;
    columns.forEach((c, i) => {
      doc.fillColor("#ffffff").text(c.name, x + pad, y + pad, { width: widths[i] - pad * 2, align: isNumericColumn(c) ? "right" : "left" });
      x += widths[i];
    });
    return y + h;
  };

  header();
  let y = tableHeader(doc.y);
  const bottom = doc.page.height - doc.page.margins.bottom - 18;

  const drawRow = (cells: string[], bold: boolean, zebra: boolean) => {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(fontSize);
    const h = Math.max(...cells.map((t, i) => doc.heightOfString(t || " ", { width: widths[i] - pad * 2 }))) + pad * 2;
    if (y + h > bottom) {
      doc.addPage();
      y = tableHeader(doc.page.margins.top);
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(fontSize);
    }
    if (zebra) doc.rect(doc.page.margins.left, y, pageW, h).fill("#f5f8fb");
    let x = doc.page.margins.left;
    cells.forEach((t, i) => {
      const isErr = /^#[A-Z/0!?]+$/.test(t);
      doc.fillColor(isErr ? "#b42318" : INK).text(t, x + pad, y + pad, { width: widths[i] - pad * 2, align: isNumericColumn(columns[i]) ? "right" : "left" });
      x += widths[i];
    });
    doc.moveTo(doc.page.margins.left, y + h).lineTo(doc.page.margins.left + pageW, y + h).lineWidth(0.4).strokeColor(LINE).stroke();
    y += h;
  };

  if (!computed.length) {
    doc.fillColor(MUTED).font("Helvetica").fontSize(10).text("Nenhuma linha para exibir.", doc.page.margins.left, y + 12);
  }
  computed.forEach((r, i) => drawRow(columns.map((c) => cellText(c, r, showSensitive)), false, i % 2 === 1));
  const totals = totalsFor(columns, computed);
  if (totals.length && computed.length) {
    const cells = columns.map((c, i) => {
      const t = totals.find((x) => x.columnId === c.id);
      if (i === 0 && !t) return "Total";
      return t ? (t.currency ? formatMoney(t.sum) : formatNumber(t.sum)) : "";
    });
    drawRow(cells, true, false);
  }

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Rodapé dentro da margem inferior: zera a margem para o PDFKit não abrir página nova.
    const bottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const fy = doc.page.height - bottomMargin + 8;
    doc.fillColor(MUTED).font("Helvetica").fontSize(7);
    doc.text(`Documento interno · Confidencial · ${computed.length} linha(s)`, doc.page.margins.left, fy, { lineBreak: false });
    doc.text(`Página ${i + 1} de ${range.count}`, doc.page.margins.left, fy, { width: pageW, align: "right", lineBreak: false });
    doc.page.margins.bottom = bottomMargin;
  }
  doc.end();
  await done;
  logExport(core, actor, detail.id, detail.title, "PDF", computed.length, clientName);
  return { buffer: Buffer.concat(chunks), filename: `${fileBaseName(detail.title, clientName)}.pdf` };
}
