// Estado de uma planilha aberta: dados, salvamento automático com fila offline,
// controle de concorrência por célula e atualização em tempo real (SSE).

import { useCallback, useEffect, useRef, useState } from "react";
import type { CellConflict, CellValue, Column, RowData, SheetRecord, SpreadsheetDetail } from "../../../shared/types.js";
import { coerceValue } from "../../../shared/columns.js";
import { isCellFormula, toStoredFormula, FormulaSyntaxError } from "../../../shared/formula.js";
import { api, ApiError } from "./api";

export type SaveState = "idle" | "saving" | "saved" | "error" | "offline";

interface OutOp {
  recordId: string;
  columnId: string;
  value: CellValue;
  expected: CellValue;
}

export interface CellChange {
  recordId: string;
  columnId: string;
  value: CellValue;
}

const key = (r: string, c: string) => `${r}:${c}`;

function loadOutbox(id: string): Map<string, OutOp> {
  try {
    const raw = localStorage.getItem(`ci_outbox_${id}`);
    if (!raw) return new Map();
    const arr = JSON.parse(raw) as OutOp[];
    return new Map(arr.map((o) => [key(o.recordId, o.columnId), o]));
  } catch {
    return new Map();
  }
}

function saveOutbox(id: string, box: Map<string, OutOp>) {
  try {
    if (box.size) localStorage.setItem(`ci_outbox_${id}`, JSON.stringify([...box.values()]));
    else localStorage.removeItem(`ci_outbox_${id}`);
  } catch {
    /* armazenamento indisponível: a fila continua em memória */
  }
}

/** Converte o que o usuário digitou no valor que o servidor guarda (mesma regra do servidor). */
export function toStored(col: Column, columns: Column[], raw: unknown, year?: number): { ok: true; value: CellValue } | { ok: false; error: string } {
  const c = coerceValue(col, raw, { year });
  if (!c.ok) return c;
  if (isCellFormula(c.value)) {
    try {
      return { ok: true, value: "=" + toStoredFormula(c.value, columns) };
    } catch (e) {
      return { ok: false, error: e instanceof FormulaSyntaxError ? `Fórmula inválida: ${e.message}` : "Fórmula inválida." };
    }
  }
  return c;
}

const same = (a: CellValue | undefined, b: CellValue | undefined) => (a ?? null) === (b ?? null) || (a === "" && b == null) || (b === "" && a == null);

export function useSheet(id: string, clientId: string | null, opts: { myId: string; onConflict: (c: CellConflict[]) => void; onError: (msg: string) => void; onRemote: (name: string, what: string) => void }) {
  const [detail, setDetail] = useState<SpreadsheetDetail | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set());
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const [conflicts, setConflicts] = useState<Set<string>>(new Set());
  const outbox = useRef<Map<string, OutOp>>(loadOutbox(id));
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retry = useRef(0);
  const undoStack = useRef<CellChange[][]>([]);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const detailRef = useRef<SpreadsheetDetail | null>(null);
  detailRef.current = detail;

  const syncPending = () => setPendingKeys(new Set(outbox.current.keys()));

  /** Aplica a fila local por cima dos dados vindos do servidor. */
  const overlay = (d: SpreadsheetDetail): SpreadsheetDetail => {
    if (!outbox.current.size) return d;
    const byRec = new Map<string, OutOp[]>();
    for (const op of outbox.current.values()) {
      const arr = byRec.get(op.recordId) ?? [];
      arr.push(op);
      byRec.set(op.recordId, arr);
    }
    return {
      ...d,
      records: d.records.map((r) => {
        const ops = byRec.get(r.id);
        if (!ops) return r;
        const data = { ...r.data };
        for (const op of ops) data[op.columnId] = op.value;
        return { ...r, data };
      }),
    };
  };

  const load = useCallback(async () => {
    try {
      const d = await api.get<SpreadsheetDetail>(`/api/spreadsheets/${id}${clientId ? `?clientId=${encodeURIComponent(clientId)}` : ""}`);
      setDetail(overlay(d));
      setError(null);
    } catch (e) {
      setError(e as Error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, clientId]);

  useEffect(() => {
    outbox.current = loadOutbox(id);
    syncPending();
    setDetail(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, clientId]);

  const setRecordValues = (changes: CellChange[]) => {
    setDetail((d) => {
      if (!d) return d;
      const byRec = new Map<string, CellChange[]>();
      for (const c of changes) {
        const arr = byRec.get(c.recordId) ?? [];
        arr.push(c);
        byRec.set(c.recordId, arr);
      }
      return {
        ...d,
        records: d.records.map((r) => {
          const cs = byRec.get(r.id);
          if (!cs) return r;
          const data: RowData = { ...r.data };
          for (const c of cs) data[c.columnId] = c.value;
          return { ...r, data };
        }),
      };
    });
  };

  const flush = useCallback(async () => {
    if (inFlight.current || !outbox.current.size) return;
    inFlight.current = true;
    const batch = [...outbox.current.values()].slice(0, 2000);
    setSaveState("saving");
    try {
      const r = await api.post<{ applied: { recordId: string; columnId: string; value: CellValue; rev: number }[]; conflicts: CellConflict[]; dataRev: number }>(
        `/api/spreadsheets/${id}/cells`,
        { ops: batch },
      );
      retry.current = 0;
      for (const op of batch) {
        const k = key(op.recordId, op.columnId);
        const cur = outbox.current.get(k);
        // Só sai da fila se não foi editado de novo enquanto salvava.
        if (cur && same(cur.value, op.value)) outbox.current.delete(k);
        else if (cur) cur.expected = op.value;
      }
      if (r.conflicts.length) {
        for (const c of r.conflicts) outbox.current.delete(key(c.recordId, c.columnId));
        setRecordValues(r.conflicts.map((c) => ({ recordId: c.recordId, columnId: c.columnId, value: c.current })));
        setConflicts((s) => new Set([...s, ...r.conflicts.map((c) => key(c.recordId, c.columnId))]));
        optsRef.current.onConflict(r.conflicts);
      }
      // O servidor pode normalizar valores (ex.: "350" → 350).
      setRecordValues(r.applied.filter((a) => !outbox.current.has(key(a.recordId, a.columnId))).map((a) => ({ recordId: a.recordId, columnId: a.columnId, value: a.value })));
      saveOutbox(id, outbox.current);
      syncPending();
      setSaveState(outbox.current.size ? "saving" : "saved");
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 0 || err.status >= 500 || err.status === 429) {
        setSaveState(err.status === 0 ? "offline" : "error");
        retry.current = Math.min(retry.current + 1, 6);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => void flush(), Math.min(30_000, 1500 * 2 ** retry.current));
      } else {
        // Erro de validação/permissão: descarta o lote e recarrega para ficar igual ao servidor.
        for (const op of batch) outbox.current.delete(key(op.recordId, op.columnId));
        saveOutbox(id, outbox.current);
        syncPending();
        setSaveState("error");
        optsRef.current.onError(err.message);
        void load();
      }
    } finally {
      inFlight.current = false;
      if (outbox.current.size && retry.current === 0) {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => void flush(), 300);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 450);
  }, [flush]);

  // Ao abrir, envia o que ficou pendente de uma sessão anterior (ex.: internet caiu).
  useEffect(() => {
    if (outbox.current.size) schedule();
    const online = () => {
      retry.current = 0;
      void flush();
    };
    window.addEventListener("online", online);
    const before = (e: BeforeUnloadEvent) => {
      if (outbox.current.size) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("beforeunload", before);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [flush, schedule]);

  /** Edição local imediata + salvamento em segundo plano. */
  const edit = useCallback(
    (changes: CellChange[], opts2: { skipUndo?: boolean } = {}) => {
      const d = detailRef.current;
      if (!d || !changes.length) return;
      const recs = new Map(d.records.map((r) => [r.id, r]));
      const inverse: CellChange[] = [];
      const real: CellChange[] = [];
      for (const c of changes) {
        const rec = recs.get(c.recordId);
        if (!rec) continue;
        const before = rec.data[c.columnId] ?? null;
        if (same(before, c.value)) continue;
        real.push(c);
        inverse.push({ recordId: c.recordId, columnId: c.columnId, value: before });
        const k = key(c.recordId, c.columnId);
        const existing = outbox.current.get(k);
        if (existing) existing.value = c.value;
        else outbox.current.set(k, { recordId: c.recordId, columnId: c.columnId, value: c.value, expected: before });
        setConflicts((s) => {
          if (!s.has(k)) return s;
          const n = new Set(s);
          n.delete(k);
          return n;
        });
      }
      if (!real.length) return;
      if (!opts2.skipUndo) {
        undoStack.current.push(inverse);
        if (undoStack.current.length > 100) undoStack.current.shift();
      }
      setRecordValues(real);
      saveOutbox(id, outbox.current);
      syncPending();
      setSaveState("saving");
      schedule();
    },
    [id, schedule],
  );

  const undo = useCallback(() => {
    const last = undoStack.current.pop();
    if (last) edit(last, { skipUndo: true });
    return !!last;
  }, [edit]);

  /** Usa o meu valor mesmo após conflito (o usuário decidiu sobrescrever). */
  const forceValue = useCallback(
    (c: CellConflict) => {
      const k = key(c.recordId, c.columnId);
      outbox.current.set(k, { recordId: c.recordId, columnId: c.columnId, value: c.attempted, expected: c.current });
      setRecordValues([{ recordId: c.recordId, columnId: c.columnId, value: c.attempted }]);
      setConflicts((s) => {
        const n = new Set(s);
        n.delete(k);
        return n;
      });
      saveOutbox(id, outbox.current);
      syncPending();
      schedule();
    },
    [id, schedule],
  );

  // Tempo real: mudanças de outras pessoas aparecem sem recarregar.
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const es = new EventSource(`/api/spreadsheets/${id}/stream`);
    es.onmessage = (msg) => {
      let ev: { type: string; by: string; byName: string; changes?: { recordId: string; columnId: string; value: CellValue }[]; reason?: string };
      try {
        ev = JSON.parse(msg.data);
      } catch {
        return;
      }
      if (ev.by === optsRef.current.myId && ev.type !== "reload") return;
      if (ev.type === "cells" && ev.changes) {
        const incoming = ev.changes.filter((c) => !outbox.current.has(key(c.recordId, c.columnId)));
        setRecordValues(incoming);
        const keys = incoming.map((c) => key(c.recordId, c.columnId));
        setFlash(new Set(keys));
        setTimeout(() => setFlash(new Set()), 1500);
        if (incoming.length) optsRef.current.onRemote(ev.byName, `alterou ${incoming.length === 1 ? "1 célula" : `${incoming.length} células`}`);
      } else {
        void load();
        if (ev.by !== optsRef.current.myId) optsRef.current.onRemote(ev.byName, ev.type === "reload" ? ev.reason ?? "atualizou a planilha" : ev.type === "rows" ? "adicionou ou removeu linhas" : "alterou as colunas");
      }
    };
    return () => es.close();
  }, [id, load]);

  // ---------------------------------------------------------------- linhas

  const addRows = useCallback(
    async (rows: RowData[], afterId: string | null) => {
      const r = await api.post<{ created: SheetRecord[] }>(`/api/spreadsheets/${id}/rows`, { rows, afterId, clientId });
      setDetail((d) => {
        if (!d) return d;
        const records = [...d.records, ...r.created].sort((a, b) => a.position - b.position);
        return { ...d, records, rowCount: records.length };
      });
      return r.created;
    },
    [id, clientId],
  );

  const deleteRows = useCallback(
    async (ids: string[]) => {
      await api.post(`/api/spreadsheets/${id}/rows/delete`, { ids });
      for (const k of [...outbox.current.keys()]) if (ids.includes(k.split(":")[0])) outbox.current.delete(k);
      saveOutbox(id, outbox.current);
      syncPending();
      setDetail((d) => d && { ...d, records: d.records.filter((r) => !ids.includes(r.id)), rowCount: d.records.length - ids.length });
    },
    [id],
  );

  const restoreRows = useCallback(
    async (ids: string[]) => {
      await api.post(`/api/spreadsheets/${id}/rows/restore`, { ids });
      await load();
    },
    [id, load],
  );

  return { detail, setDetail, error, reload: load, saveState, pendingKeys, flash, conflicts, edit, undo, forceValue, addRows, deleteRows, restoreRows, flush };
}
