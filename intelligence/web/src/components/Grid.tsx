// Grade de edição estilo planilha: virtualizada, com teclado, seleção, copiar/colar,
// edição em célula, listas de opções, redimensionamento de colunas e totais.

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Calculator, Calendar, ChevronDown, CircleDollarSign, Filter, Hash, Lock, List, ToggleLeft, Type } from "lucide-react";
import type { CellValue, Column, ColumnType, RowData, SheetRecord } from "../../../shared/types.js";
import { formatCell } from "../../../shared/columns.js";
import { FormulaError, isCellFormula, toDisplayFormula, type Value } from "../../../shared/formula.js";
import { formatDateBR, isIsoDate, normalize } from "../../../shared/text.js";
import { toStored, type CellChange } from "../lib/useSheet";
import { Menu, type MenuItem } from "./ui";

const ROW_H = 34;
const HEAD_H = 38;
const FOOT_H = 36;
const INDEX_W = 48;

export const TYPE_ICON: Record<ColumnType, typeof Type> = {
  text: Type,
  number: Hash,
  currency: CircleDollarSign,
  date: Calendar,
  select: List,
  boolean: ToggleLeft,
  formula: Calculator,
};

interface Pos {
  r: number;
  c: number;
}

export interface GridProps {
  columns: Column[];
  rows: SheetRecord[];
  values: Map<string, Record<string, Value>>;
  canEdit: boolean;
  year?: number;
  sort: { colId: string; dir: "asc" | "desc" } | null;
  filtered: Set<string>;
  pendingKeys: Set<string>;
  flash: Set<string>;
  conflicts: Set<string>;
  totals: Map<string, string>;
  onEdit: (changes: CellChange[]) => void;
  onAddRows: (rows: RowData[], afterId: string | null) => Promise<unknown>;
  onDeleteRows: (ids: string[]) => void;
  onSort: (colId: string) => void;
  onColumnMenu: (col: Column, anchor: HTMLElement) => void;
  onResize: (colId: string, width: number) => void;
  onUndo: () => boolean;
  onError: (msg: string) => void;
  onFilterValue: (col: Column, value: Value) => void;
  onSelection: (s: { sum: number; count: number; cells: number } | null) => void;
}

/** Texto inicial ao editar uma célula. */
export function editText(col: Column, columns: Column[], raw: CellValue | undefined): string {
  if (raw === null || raw === undefined) return "";
  if (isCellFormula(raw)) return toDisplayFormula(raw, columns);
  if (typeof raw === "boolean") return raw ? "Sim" : "Não";
  if (typeof raw === "number") return String(raw).replace(".", ",");
  if (col.type === "date" && isIsoDate(raw)) return formatDateBR(raw);
  return String(raw);
}

function clipText(col: Column, v: Value): string {
  if (v instanceof FormulaError) return v.code;
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "Sim" : "Não";
  if (typeof v === "number") return String(v).replace(".", ",");
  if (isIsoDate(v)) return formatDateBR(v as string);
  const s = String(v);
  return /[\t\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let i = 0;
  let quoted = false;
  const t = text.replace(/\r\n?/g, "\n");
  while (i < t.length) {
    const ch = t[i];
    if (quoted) {
      if (ch === '"') {
        if (t[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"' && cell === "") {
      quoted = true;
      i++;
      continue;
    }
    if (ch === "\t") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
    i++;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export const Grid = memo(function Grid(props: GridProps) {
  const { columns, rows, values, canEdit } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, height: 600 });
  const [active, setActive] = useState<Pos | null>(null);
  const [anchor, setAnchor] = useState<Pos | null>(null);
  const [editing, setEditing] = useState<{ r: number; c: number; text: string } | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const dragging = useRef(false);

  const colWidth = useCallback((c: Column) => widths[c.id] ?? c.width ?? 150, [widths]);
  const lefts = useMemo(() => {
    const out: number[] = [];
    let x = INDEX_W;
    for (const c of columns) {
      out.push(x);
      x += colWidth(c);
    }
    out.push(x);
    return out;
  }, [columns, colWidth]);
  const totalW = lefts[lefts.length - 1];
  const bodyH = rows.length * ROW_H;

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setView({ top: el.scrollTop, height: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Mantém a seleção dentro dos limites quando linhas/colunas mudam.
  useEffect(() => {
    if (active && (active.r >= rows.length || active.c >= columns.length)) {
      setActive(rows.length && columns.length ? { r: Math.min(active.r, rows.length - 1), c: Math.min(active.c, columns.length - 1) } : null);
      setAnchor(null);
    }
  }, [rows.length, columns.length, active]);

  const range = useMemo(() => {
    if (!active) return null;
    const a = anchor ?? active;
    return { r1: Math.min(a.r, active.r), r2: Math.max(a.r, active.r), c1: Math.min(a.c, active.c), c2: Math.max(a.c, active.c) };
  }, [active, anchor]);

  // Soma/contagem da seleção (como na barra de status do Excel).
  useEffect(() => {
    if (!range || (range.r1 === range.r2 && range.c1 === range.c2)) {
      props.onSelection(null);
      return;
    }
    let sum = 0;
    let count = 0;
    let cells = 0;
    for (let r = range.r1; r <= range.r2 && r < rows.length; r++)
      for (let c = range.c1; c <= range.c2 && c < columns.length; c++) {
        cells++;
        const v = values.get(rows[r].id)?.[columns[c].id];
        if (typeof v === "number") {
          sum += Math.round(v * 100);
          count++;
        }
      }
    props.onSelection({ sum: sum / 100, count, cells });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, rows, columns, values]);

  const ensureVisible = useCallback(
    (p: Pos) => {
      const el = scrollRef.current;
      if (!el) return;
      const top = p.r * ROW_H;
      const bottom = top + ROW_H;
      const viewTop = el.scrollTop;
      const viewBottom = el.scrollTop + el.clientHeight - HEAD_H - FOOT_H;
      if (top < viewTop) el.scrollTop = top;
      else if (bottom > viewBottom) el.scrollTop = bottom - (el.clientHeight - HEAD_H - FOOT_H);
      const left = lefts[p.c];
      const right = lefts[p.c + 1];
      if (left - INDEX_W < el.scrollLeft) el.scrollLeft = left - INDEX_W;
      else if (right > el.scrollLeft + el.clientWidth) el.scrollLeft = right - el.clientWidth;
    },
    [lefts],
  );

  const move = useCallback(
    (p: Pos, extend = false) => {
      const np = { r: Math.max(0, Math.min(rows.length - 1, p.r)), c: Math.max(0, Math.min(columns.length - 1, p.c)) };
      if (!rows.length || !columns.length) return;
      if (!extend) setAnchor(null);
      else if (!anchor) setAnchor(active);
      setActive(np);
      ensureVisible(np);
    },
    [rows.length, columns.length, anchor, active, ensureVisible],
  );

  const startEdit = useCallback(
    (p: Pos, initial?: string) => {
      if (!canEdit) return;
      const col = columns[p.c];
      const rec = rows[p.r];
      if (!col || !rec) return;
      if (col.type === "formula") {
        props.onError(`“${col.name}” é calculada automaticamente pela fórmula da coluna.`);
        return;
      }
      if (col.type === "boolean" && initial === undefined) {
        props.onEdit([{ recordId: rec.id, columnId: col.id, value: !(rec.data[col.id] === true) }]);
        return;
      }
      setEditing({ r: p.r, c: p.c, text: initial ?? editText(col, columns, rec.data[col.id]) });
    },
    [canEdit, columns, rows, props],
  );

  const commit = useCallback(
    (text: string, then?: Pos): boolean => {
      if (!editing) return true;
      const col = columns[editing.c];
      const rec = rows[editing.r];
      const res = toStored(col, columns, text, props.year);
      if (!res.ok) {
        props.onError(res.error);
        return false;
      }
      props.onEdit([{ recordId: rec.id, columnId: col.id, value: res.value }]);
      setEditing(null);
      scrollRef.current?.focus({ preventScroll: true });
      if (then) move(then);
      return true;
    },
    [editing, columns, rows, props, move],
  );

  const clearRange = useCallback(() => {
    if (!range || !canEdit) return;
    const changes: CellChange[] = [];
    for (let r = range.r1; r <= range.r2; r++)
      for (let c = range.c1; c <= range.c2; c++) {
        const col = columns[c];
        if (col.type === "formula") continue;
        changes.push({ recordId: rows[r].id, columnId: col.id, value: null });
      }
    props.onEdit(changes);
  }, [range, canEdit, columns, rows, props]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (editing) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (!props.onUndo()) props.onError("Nada para desfazer.");
      return;
    }
    if (mod && e.key.toLowerCase() === "a") {
      e.preventDefault();
      setAnchor({ r: 0, c: 0 });
      setActive({ r: rows.length - 1, c: columns.length - 1 });
      return;
    }
    if (!active) {
      if (["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Enter", "Tab"].includes(e.key) && rows.length) {
        e.preventDefault();
        move({ r: 0, c: 0 });
      }
      return;
    }
    const page = Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 400) / ROW_H) - 2);
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        move({ r: mod ? rows.length - 1 : active.r + 1, c: active.c }, e.shiftKey);
        return;
      case "ArrowUp":
        e.preventDefault();
        move({ r: mod ? 0 : active.r - 1, c: active.c }, e.shiftKey);
        return;
      case "ArrowRight":
        e.preventDefault();
        move({ r: active.r, c: mod ? columns.length - 1 : active.c + 1 }, e.shiftKey);
        return;
      case "ArrowLeft":
        e.preventDefault();
        move({ r: active.r, c: mod ? 0 : active.c - 1 }, e.shiftKey);
        return;
      case "PageDown":
        e.preventDefault();
        move({ r: active.r + page, c: active.c }, e.shiftKey);
        return;
      case "PageUp":
        e.preventDefault();
        move({ r: active.r - page, c: active.c }, e.shiftKey);
        return;
      case "Home":
        e.preventDefault();
        move({ r: mod ? 0 : active.r, c: 0 }, e.shiftKey);
        return;
      case "End":
        e.preventDefault();
        move({ r: mod ? rows.length - 1 : active.r, c: columns.length - 1 }, e.shiftKey);
        return;
      case "Tab":
        e.preventDefault();
        move({ r: active.r, c: active.c + (e.shiftKey ? -1 : 1) });
        return;
      case "Enter":
      case "F2":
        e.preventDefault();
        startEdit(active);
        return;
      case "Delete":
      case "Backspace":
        e.preventDefault();
        clearRange();
        return;
      case " ":
        if (columns[active.c]?.type === "boolean") {
          e.preventDefault();
          startEdit(active);
          return;
        }
    }
    if (e.key.length === 1 && !mod && !e.altKey) {
      e.preventDefault();
      startEdit(active, e.key);
    }
  }

  function onCopy(e: React.ClipboardEvent, cut = false) {
    if (editing || !range) return;
    e.preventDefault();
    const lines: string[] = [];
    for (let r = range.r1; r <= range.r2; r++) {
      const cells: string[] = [];
      for (let c = range.c1; c <= range.c2; c++) cells.push(clipText(columns[c], values.get(rows[r].id)?.[columns[c].id] ?? null));
      lines.push(cells.join("\t"));
    }
    e.clipboardData.setData("text/plain", lines.join("\n"));
    if (cut) clearRange();
  }

  async function onPaste(e: React.ClipboardEvent) {
    if (editing || !active || !canEdit) return;
    e.preventDefault();
    const data = parseTsv(e.clipboardData.getData("text/plain"));
    if (!data.length) return;
    // Um valor só colado sobre uma seleção maior preenche a seleção inteira.
    const fill = data.length === 1 && data[0].length === 1 && range && (range.r2 > range.r1 || range.c2 > range.c1);
    const startR = fill ? range!.r1 : active.r;
    const startC = fill ? range!.c1 : active.c;
    const height = fill ? range!.r2 - range!.r1 + 1 : data.length;
    const width = fill ? range!.c2 - range!.c1 + 1 : Math.max(...data.map((r) => r.length));
    const changes: CellChange[] = [];
    const extra: RowData[] = [];
    const errors: string[] = [];
    for (let i = 0; i < height; i++) {
      const src = fill ? data[0] : data[i];
      const newRow: RowData = {};
      for (let j = 0; j < width; j++) {
        const col = columns[startC + j];
        if (!col || col.type === "formula") continue;
        const text = fill ? src[0] : src[j];
        if (text === undefined) continue;
        const res = toStored(col, columns, text, props.year);
        if (!res.ok) {
          if (errors.length < 3) errors.push(res.error);
          continue;
        }
        const r = startR + i;
        if (r < rows.length) changes.push({ recordId: rows[r].id, columnId: col.id, value: res.value });
        else if (res.value !== null) newRow[col.id] = res.value;
      }
      if (startR + i >= rows.length && Object.keys(newRow).length) extra.push(newRow);
    }
    if (changes.length) props.onEdit(changes);
    if (extra.length) await props.onAddRows(extra, rows.length ? rows[rows.length - 1].id : null);
    if (errors.length) props.onError(`Alguns valores não foram colados: ${errors[0]}`);
    setAnchor({ r: startR, c: startC });
    setActive({ r: Math.min(startR + height - 1, rows.length - 1 + extra.length), c: Math.min(startC + width - 1, columns.length - 1) });
  }

  useEffect(() => {
    const up = () => (dragging.current = false);
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  // ---------------------------------------------------------------- redimensionar colunas
  function startResize(e: React.MouseEvent, col: Column) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = colWidth(col);
    const target = e.currentTarget as HTMLElement;
    target.classList.add("dragging");
    const onMove = (ev: MouseEvent) => setWidths((w) => ({ ...w, [col.id]: Math.max(60, Math.min(800, startW + ev.clientX - startX)) }));
    const onUp = (ev: MouseEvent) => {
      target.classList.remove("dragging");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const w = Math.max(60, Math.min(800, startW + ev.clientX - startX));
      if (Math.abs(w - startW) > 2) props.onResize(col.id, w);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  // ---------------------------------------------------------------- menus de contexto
  function rowMenu(x: number, y: number, r: number) {
    const rec = rows[r];
    const ids = selectedRows.has(rec.id) ? [...selectedRows] : [rec.id];
    setMenu({
      x,
      y,
      items: canEdit
        ? [
            { label: "Inserir linha acima", onSelect: () => void props.onAddRows([{}], r > 0 ? rows[r - 1].id : null) },
            { label: "Inserir linha abaixo", onSelect: () => void props.onAddRows([{}], rec.id) },
            { divider: true, label: "" },
            { label: ids.length > 1 ? `Excluir ${ids.length} linhas` : "Excluir linha", danger: true, onSelect: () => (props.onDeleteRows(ids), setSelectedRows(new Set())) },
          ]
        : [{ label: "Somente leitura", disabled: true }],
    });
  }

  function cellMenu(x: number, y: number, p: Pos) {
    const col = columns[p.c];
    const v = values.get(rows[p.r].id)?.[col.id] ?? null;
    setMenu({
      x,
      y,
      items: [
        { label: "Copiar valor", onSelect: () => void navigator.clipboard?.writeText(clipText(col, v)) },
        { label: "Filtrar por este valor", onSelect: () => props.onFilterValue(col, v) },
        ...(canEdit
          ? [
              { divider: true, label: "" },
              { label: "Editar célula", onSelect: () => startEdit(p), disabled: col.type === "formula" },
              { label: "Limpar seleção", onSelect: clearRange },
              { divider: true, label: "" },
              { label: "Inserir linha abaixo", onSelect: () => void props.onAddRows([{}], rows[p.r].id) },
              { label: "Excluir linha", danger: true, onSelect: () => props.onDeleteRows([rows[p.r].id]) },
            ]
          : []),
      ],
    });
  }

  // ---------------------------------------------------------------- renderização
  const first = Math.max(0, Math.floor(view.top / ROW_H) - 8);
  const last = Math.min(rows.length, Math.ceil((view.top + view.height) / ROW_H) + 8);
  const visible = rows.slice(first, last);

  const statusCol = columns.find((c) => c.role === "status");
  const pendingSet = new Set((statusCol?.pendingValues ?? []).map(normalize));
  const paidSet = new Set((statusCol?.paidValues ?? []).map(normalize));

  return (
    <div className="grid-scroll" ref={scrollRef} tabIndex={0} onScroll={(e) => setView({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })} onKeyDown={onKeyDown} onCopy={(e) => onCopy(e)} onCut={(e) => onCopy(e, true)} onPaste={(e) => void onPaste(e)} role="grid" aria-rowcount={rows.length} aria-colcount={columns.length} aria-label="Planilha">
      <div className="grid" style={{ width: totalW, minWidth: "100%" }}>
        <div className="g-head" style={{ width: totalW }} role="row">
          <div className="g-cell g-index" style={{ width: INDEX_W }} title="Selecionar todas" onClick={() => setSelectedRows(selectedRows.size === rows.length ? new Set() : new Set(rows.map((r) => r.id)))}>
            #
          </div>
          {columns.map((col) => {
            const Icon = TYPE_ICON[col.type];
            const sorted = props.sort?.colId === col.id ? props.sort.dir : null;
            return (
              <div key={col.id} className="g-cell" style={{ width: colWidth(col) }} role="columnheader" title={col.type === "formula" ? `Calculada: ${toDisplayFormula(col.formula ?? "", columns)}` : col.name}>
                <Icon />
                <span className="col-name" onClick={() => props.onSort(col.id)} style={{ cursor: "pointer" }}>
                  {col.name}
                </span>
                {col.sensitive && <Lock aria-label="Dado sensível" />}
                {props.filtered.has(col.id) && <Filter style={{ color: "var(--accent)" }} aria-label="Filtrada" />}
                {sorted === "asc" && <ArrowUp style={{ color: "var(--accent)" }} />}
                {sorted === "desc" && <ArrowDown style={{ color: "var(--accent)" }} />}
                <button className="col-btn" aria-label={`Opções da coluna ${col.name}`} onClick={(e) => props.onColumnMenu(col, e.currentTarget)}>
                  <ChevronDown />
                </button>
                {canEdit && <span className="resize-handle" onMouseDown={(e) => startResize(e, col)} aria-hidden />}
              </div>
            );
          })}
        </div>

        <div style={{ position: "relative", height: bodyH }}>
          {visible.map((rec, i) => {
            const r = first + i;
            const vals = values.get(rec.id) ?? {};
            const rowSelected = selectedRows.has(rec.id);
            return (
              <div key={rec.id} className="g-row" style={{ top: r * ROW_H, width: totalW }} role="row" aria-rowindex={r + 1}>
                <div
                  className={`g-cell g-index ${rowSelected ? "selected" : ""}`}
                  style={{ width: INDEX_W }}
                  onClick={(e) => {
                    setSelectedRows((s) => {
                      const n = new Set(e.ctrlKey || e.metaKey ? s : []);
                      if (e.shiftKey && s.size) {
                        const idx = rows.findIndex((x) => s.has(x.id));
                        for (let k = Math.min(idx, r); k <= Math.max(idx, r); k++) n.add(rows[k].id);
                      } else if (n.has(rec.id)) n.delete(rec.id);
                      else n.add(rec.id);
                      return n;
                    });
                    setAnchor({ r, c: 0 });
                    setActive({ r, c: columns.length - 1 });
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    rowMenu(e.clientX, e.clientY, r);
                  }}
                >
                  {r + 1}
                </div>
                {columns.map((col, c) => {
                  const v = vals[col.id];
                  const k = `${rec.id}:${col.id}`;
                  const inRange = range && r >= range.r1 && r <= range.r2 && c >= range.c1 && c <= range.c2;
                  const isActive = active?.r === r && active?.c === c;
                  const isErr = v instanceof FormulaError;
                  const text = formatCell(col, v);
                  const cls = [
                    "g-cell",
                    typeof v === "number" || col.type === "number" || col.type === "currency" ? "num" : "",
                    col.type === "formula" || isCellFormula(rec.data[col.id] ?? null) ? "formula" : "",
                    isErr ? "err" : "",
                    inRange && !isActive ? "sel-range" : "",
                    isActive ? "active" : "",
                    props.conflicts.has(k) ? "conflict" : "",
                    props.flash.has(k) ? "flash" : "",
                    props.pendingKeys.has(k) ? "pending" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  let content: React.ReactNode = text;
                  if (col === statusCol && typeof v === "string" && v) {
                    const n = normalize(v);
                    content = <span className={`status-pill ${paidSet.has(n) ? "paid" : pendingSet.has(n) ? "pending" : ""}`}>{v}</span>;
                  }
                  return (
                    <div
                      key={col.id}
                      className={cls}
                      style={{ width: colWidth(col) }}
                      role="gridcell"
                      aria-selected={isActive}
                      title={isErr ? `${(v as FormulaError).code} ${(v as FormulaError).detail || "— a fórmula usa um valor que não é número"}` : text.length > 18 ? text : undefined}
                      onMouseDown={(e) => {
                        if (e.button !== 0) return;
                        dragging.current = true;
                        scrollRef.current?.focus({ preventScroll: true });
                        if (e.shiftKey && active) {
                          if (!anchor) setAnchor(active);
                          setActive({ r, c });
                        } else {
                          setAnchor(null);
                          setActive({ r, c });
                        }
                        setSelectedRows(new Set());
                      }}
                      onMouseEnter={() => {
                        if (dragging.current && active) {
                          if (!anchor) setAnchor(active);
                          setActive({ r, c });
                        }
                      }}
                      onDoubleClick={() => startEdit({ r, c })}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        if (!inRange) {
                          setAnchor(null);
                          setActive({ r, c });
                        }
                        cellMenu(e.clientX, e.clientY, { r, c });
                      }}
                    >
                      <span>{content}</span>
                    </div>
                  );
                })}
              </div>
            );
          })}
          {editing && <CellEditor key={`${editing.r}:${editing.c}`} col={columns[editing.c]} initial={editing.text} top={editing.r * ROW_H} left={lefts[editing.c]} width={colWidth(columns[editing.c])} onCommit={commit} onCancel={() => (setEditing(null), scrollRef.current?.focus({ preventScroll: true }))} pos={editing} />}
        </div>

        <div className="g-foot" style={{ width: totalW }} role="row">
          <div className="g-cell g-index" style={{ width: INDEX_W }} title="Totais das linhas visíveis">
            Σ
          </div>
          {columns.map((col) => (
            <div key={col.id} className="g-cell num" style={{ width: colWidth(col) }}>
              <span>{props.totals.get(col.id) ?? ""}</span>
            </div>
          ))}
        </div>
      </div>
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </div>
  );
});

function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <span ref={setAnchor} style={{ position: "fixed", left: x, top: y, width: 1, height: 1 }} />
      {anchor && <Menu anchor={anchor} items={items} onClose={onClose} />}
    </>
  );
}

function CellEditor({
  col,
  initial,
  top,
  left,
  width,
  onCommit,
  onCancel,
  pos,
}: {
  col: Column;
  initial: string;
  top: number;
  left: number;
  width: number;
  onCommit: (text: string, then?: Pos) => boolean;
  onCancel: () => void;
  pos: Pos;
}) {
  const [text, setText] = useState(initial);
  const [hi, setHi] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    const el = ref.current!;
    el.focus();
    const len = el.value.length;
    el.setSelectionRange(len, len);
  }, []);
  const options = col.type === "select" ? (col.options ?? []).filter((o) => !text || normalize(o).includes(normalize(text)) || text === initial) : [];
  const finish = (value: string, then?: Pos) => {
    if (done.current) return;
    done.current = onCommit(value, then);
  };
  return (
    <>
      <input
        ref={ref}
        className="g-editor"
        style={{ top, left, width: Math.max(width, 120), height: ROW_H }}
        value={text}
        placeholder={col.type === "date" ? "dd/mm/aaaa" : undefined}
        inputMode={col.type === "number" || col.type === "currency" ? "decimal" : undefined}
        onChange={(e) => {
          setText(e.target.value);
          setHi(0);
        }}
        onBlur={() => finish(text)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            done.current = true;
            onCancel();
          } else if (e.key === "Enter") {
            e.preventDefault();
            const v = options.length && text !== initial ? options[hi] ?? text : text;
            finish(v, { r: pos.r + 1, c: pos.c });
          } else if (e.key === "Tab") {
            e.preventDefault();
            const v = options.length && text !== initial ? options[hi] ?? text : text;
            finish(v, { r: pos.r, c: pos.c + (e.shiftKey ? -1 : 1) });
          } else if (options.length && e.key === "ArrowDown") {
            e.preventDefault();
            setHi((h) => Math.min(options.length - 1, h + 1));
          } else if (options.length && e.key === "ArrowUp") {
            e.preventDefault();
            setHi((h) => Math.max(0, h - 1));
          }
        }}
        aria-label={`Editar ${col.name}`}
      />
      {col.type === "select" && options.length > 0 && (
        <div className="g-editor-list" style={{ top: top + ROW_H + 2, left }} role="listbox">
          {options.map((o, i) => (
            <button
              key={o}
              role="option"
              aria-selected={i === hi}
              onMouseDown={(e) => {
                e.preventDefault();
                finish(o, { r: pos.r + 1, c: pos.c });
              }}
            >
              {o}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
