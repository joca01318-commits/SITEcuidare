import { useEffect, useMemo, useState } from "react";
import { History, Plus, RotateCcw, Search, Trash2, X } from "lucide-react";
import type { AuditEvent, Column, ColumnRole, ColumnType, RowData, SheetRecord } from "../../../shared/types.js";
import { COLUMN_ROLE_LABEL } from "../../../shared/types.js";
import { COLUMN_TYPE_LABEL, findRole, formatCell } from "../../../shared/columns.js";
import { toDisplayFormula, type Value } from "../../../shared/formula.js";
import { normalize } from "../../../shared/text.js";
import { api } from "../lib/api";
import { dateTime, relTime, SOURCE_LABEL } from "../lib/format";
import { toStored, type CellChange } from "../lib/useSheet";
import { editText } from "./Grid";
import { Dialog, Empty, SkeletonRows, useConfirm, useToast } from "./ui";

// ------------------------------------------------------------------ configurar coluna

export function ColumnDialog({
  sheetId,
  column,
  columns,
  schemaRev,
  isClientColumn,
  onClose,
  onSaved,
}: {
  sheetId: string;
  column: Column | null;
  columns: Column[];
  schemaRev: number;
  isClientColumn: boolean;
  onClose: () => void;
  onSaved: (msg?: string) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(column?.name ?? "");
  const [type, setType] = useState<ColumnType>(column?.type ?? "text");
  const [options, setOptions] = useState((column?.options ?? []).join("\n"));
  const [formula, setFormula] = useState(column?.formula ? toDisplayFormula(column.formula, columns) : "");
  const [role, setRole] = useState<ColumnRole | "">(column?.role ?? "");
  const [sensitive, setSensitive] = useState(!!column?.sensitive);
  const [carryOver, setCarryOver] = useState(!!column?.carryOver);
  const [pending, setPending] = useState<string[]>(column?.pendingValues ?? []);
  const [paid, setPaid] = useState<string[]>(column?.paidValues ?? []);
  const [busy, setBusy] = useState(false);
  const optionList = options.split("\n").map((o) => o.trim()).filter(Boolean);

  async function save() {
    setBusy(true);
    const body: Record<string, unknown> = {
      name,
      type,
      role: role || null,
      sensitive,
      carryOver,
      schemaRev,
      ...(type === "select" ? { options: optionList } : {}),
      ...(type === "formula" ? { formula } : {}),
      ...(role === "status" ? { pendingValues: pending, paidValues: paid } : {}),
    };
    try {
      if (column) {
        const r = await api.patch<{ converted: number; unconverted: number }>(`/api/spreadsheets/${sheetId}/columns/${column.id}`, body);
        onSaved(r.unconverted ? `${r.unconverted} valor(es) não puderam ser convertidos para o novo tipo e ficaram como estavam.` : undefined);
      } else {
        await api.post(`/api/spreadsheets/${sheetId}/columns`, body);
        onSaved();
      }
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }

  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <Dialog
      title={column ? `Coluna “${column.name}”` : "Nova coluna"}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn primary" onClick={save} disabled={busy || !name.trim() || (type === "formula" && !formula.trim())}>
            {busy ? "Salvando…" : "Salvar"}
          </button>
        </>
      }
    >
      <div className="stack">
        <label className="field">
          <span>Nome</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </label>
        <label className="field">
          <span>Tipo</span>
          <select className="select" value={type} onChange={(e) => setType(e.target.value as ColumnType)}>
            {(Object.keys(COLUMN_TYPE_LABEL) as ColumnType[]).map((t) => (
              <option key={t} value={t}>
                {COLUMN_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
          {column && type !== column.type && type !== "formula" && <span className="hint">Os valores existentes serão convertidos quando possível. Uma versão é salva antes.</span>}
        </label>
        {type === "select" && (
          <label className="field">
            <span>Opções (uma por linha)</span>
            <textarea className="textarea" value={options} onChange={(e) => setOptions(e.target.value)} placeholder={"PAGO\nPENDENTE\nPARCIAL"} />
          </label>
        )}
        {type === "formula" && (
          <div className="field">
            <span>Fórmula</span>
            <input className="input" style={{ fontFamily: "var(--mono)" }} value={formula} onChange={(e) => setFormula(e.target.value)} placeholder="([Qtd Plantões] - [Faltas]) * [Valor Plantão]" />
            <span className="hint">Use o nome das colunas entre colchetes. Funções: SOMA, SE, ARRED, MÍNIMO, MÁXIMO, MÉDIA, SEERRO, E, OU.</span>
            <div className="chips">
              {columns
                .filter((c) => c.id !== column?.id)
                .map((c) => (
                  <button key={c.id} type="button" className="chip" onClick={() => setFormula((f) => `${f}${f && !f.endsWith(" ") ? " " : ""}[${c.name}]`)}>
                    {c.name}
                  </button>
                ))}
            </div>
          </div>
        )}
        <label className="field">
          <span>Papel da coluna</span>
          <select className="select" value={role} onChange={(e) => setRole(e.target.value as ColumnRole | "")}>
            <option value="">Nenhum</option>
            {(Object.keys(COLUMN_ROLE_LABEL) as ColumnRole[]).map((r) => (
              <option key={r} value={r}>
                {COLUMN_ROLE_LABEL[r]}
              </option>
            ))}
          </select>
          <span className="hint">
            É o que permite à assistente entender perguntas como “quanto foi pago” ou “o que está pendente”.
            {isClientColumn ? " Esta coluna liga as linhas aos clientes cadastrados." : ""}
          </span>
        </label>
        {role === "status" && optionList.length > 0 && (
          <div className="stack" style={{ gap: 8 }}>
            <span className="label">Quais valores significam…</span>
            <div className="row wrap" style={{ gap: 14 }}>
              <div className="stack" style={{ gap: 6 }}>
                <strong className="small">Pendente</strong>
                {optionList.map((o) => (
                  <label key={o} className="check">
                    <input type="checkbox" checked={pending.includes(o)} onChange={() => toggle(pending, setPending, o)} /> {o}
                  </label>
                ))}
              </div>
              <div className="stack" style={{ gap: 6 }}>
                <strong className="small">Pago</strong>
                {optionList.map((o) => (
                  <label key={o} className="check">
                    <input type="checkbox" checked={paid.includes(o)} onChange={() => toggle(paid, setPaid, o)} /> {o}
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}
        <label className="check">
          <input type="checkbox" checked={sensitive} onChange={(e) => setSensitive(e.target.checked)} />
          Dado pessoal sensível (PIX, CPF, telefone…): oculto para perfis de leitura e nunca enviado a IA externa
        </label>
        <label className="check">
          <input type="checkbox" checked={carryOver} onChange={(e) => setCarryOver(e.target.checked)} />
          Copiar este valor ao criar a planilha do mês seguinte
        </label>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ filtro por valores

export function FilterDialog({
  column,
  values,
  selected,
  onApply,
  onClose,
}: {
  column: Column;
  values: string[];
  selected: Set<string> | null;
  onApply: (s: Set<string> | null) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set(selected ?? values));
  const shown = values.filter((v) => !q || normalize(v).includes(normalize(q)));
  return (
    <Dialog
      title={`Filtrar “${column.name}”`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={() => (onApply(null), onClose())}>
            Limpar filtro
          </button>
          <button className="btn primary" onClick={() => (onApply(sel.size === values.length ? null : sel), onClose())}>
            Aplicar
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="input-icon">
          <Search />
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procurar valor…" />
        </div>
        <div className="row">
          <button className="btn sm" onClick={() => setSel(new Set(values))}>
            Marcar todos
          </button>
          <button className="btn sm" onClick={() => setSel(new Set())}>
            Desmarcar todos
          </button>
          <span className="muted small">{sel.size} de {values.length}</span>
        </div>
        <div className="stack" style={{ gap: 6, maxHeight: 320, overflow: "auto" }}>
          {shown.map((v) => (
            <label key={v} className="check">
              <input
                type="checkbox"
                checked={sel.has(v)}
                onChange={() =>
                  setSel((s) => {
                    const n = new Set(s);
                    if (n.has(v)) n.delete(v);
                    else n.add(v);
                    return n;
                  })
                }
              />
              {v === "" ? <em className="muted">(vazio)</em> : v}
            </label>
          ))}
        </div>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ versões

interface Version {
  id: string;
  number: number;
  reason: string;
  source: string;
  rowCount: number;
  createdAt: string;
  createdByName: string | null;
}

export function VersionsDrawer({ sheetId, canRestore, onClose, onRestored }: { sheetId: string; canRestore: boolean; onClose: () => void; onRestored: () => void }) {
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [preview, setPreview] = useState<{ v: Version; columns: Column[]; records: { data: RowData }[]; totalRows: number } | null>(null);
  const confirm = useConfirm();
  const toast = useToast();
  const load = () =>
    api
      .get<{ versions: Version[] }>(`/api/spreadsheets/${sheetId}/versions`)
      .then((r) => setVersions(r.versions))
      .catch((e) => toast.error(e));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetId]);

  async function restore(v: Version) {
    const ok = await confirm({
      title: `Restaurar a versão ${v.number}?`,
      text: `A planilha voltará a ficar como estava em ${dateTime(v.createdAt)} (${v.rowCount} linhas). O estado atual é guardado antes como uma nova versão, então nada se perde.`,
      confirm: "Restaurar",
    });
    if (!ok) return;
    try {
      await api.post(`/api/spreadsheets/${sheetId}/versions/${v.id}/restore`);
      toast.success(`Versão ${v.number} restaurada.`);
      onRestored();
      void load();
    } catch (e) {
      toast.error(e);
    }
  }

  async function open(v: Version) {
    try {
      const r = await api.get<{ columns: Column[]; records: { data: RowData }[]; totalRows: number }>(`/api/spreadsheets/${sheetId}/versions/${v.id}`);
      setPreview({ v, ...r });
    } catch (e) {
      toast.error(e);
    }
  }

  return (
    <>
    <div className="overlay" style={{ background: "rgba(15,28,40,.18)", zIndex: 155 }} onClick={onClose} />
    <aside className="drawer" aria-label="Versões">
      <div className="drawer-head">
        <RotateCcw style={{ width: 18, color: "var(--text-3)" }} />
        <h2 style={{ flex: 1 }}>Versões</h2>
        <button className="btn ghost icon sm" onClick={onClose} aria-label="Fechar">
          <X />
        </button>
      </div>
      <div className="drawer-body">
        <p className="muted small" style={{ padding: "12px 18px 0" }}>
          Uma versão é guardada automaticamente antes de importações, ações da assistente, exclusões e a cada sessão de edição.
        </p>
        {!versions ? (
          <SkeletonRows n={4} />
        ) : !versions.length ? (
          <Empty icon={<RotateCcw />} title="Nenhuma versão ainda" />
        ) : (
          versions.map((v) => (
            <div key={v.id} className="activity" style={{ alignItems: "center" }}>
              <span className="dot">{v.number}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13 }}>{v.reason}</div>
                <div className="muted small">
                  {dateTime(v.createdAt)} · {v.createdByName ?? "Sistema"} · {v.rowCount} linhas
                </div>
              </div>
              <button className="btn sm" onClick={() => open(v)}>
                Ver
              </button>
              {canRestore && (
                <button className="btn sm" onClick={() => restore(v)}>
                  Restaurar
                </button>
              )}
            </div>
          ))
        )}
      </div>
      {preview && (
        <Dialog wide title={`Versão ${preview.v.number} · ${dateTime(preview.v.createdAt)}`} onClose={() => setPreview(null)}>
          <p className="muted small" style={{ marginBottom: 10 }}>
            {preview.totalRows} linhas{preview.totalRows > preview.records.length ? ` (mostrando ${preview.records.length})` : ""}. Somente visualização.
          </p>
          <div className="msg-table" style={{ maxHeight: "60vh" }}>
            <table>
              <thead>
                <tr>
                  {preview.columns.map((c) => (
                    <th key={c.id}>{c.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.records.slice(0, 200).map((r, i) => (
                  <tr key={i}>
                    {preview.columns.map((c) => (
                      <td key={c.id}>{c.type === "formula" ? "ƒ" : String(r.data[c.id] ?? "").startsWith("=") ? "ƒ" : formatCell(c, r.data[c.id] ?? null)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Dialog>
      )}
    </aside>
    </>
  );
}

// ------------------------------------------------------------------ histórico

export function HistoryDrawer({ sheetId, onClose }: { sheetId: string; onClose: () => void }) {
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [more, setMore] = useState(true);
  const [openSeq, setOpenSeq] = useState<number | null>(null);
  const toast = useToast();
  const load = async (before?: number) => {
    try {
      const r = await api.get<{ events: AuditEvent[] }>(`/api/spreadsheets/${sheetId}/history${before ? `?before=${before}` : ""}`);
      setEvents((e) => (before ? [...(e ?? []), ...r.events] : r.events));
      setMore(r.events.length === 50);
    } catch (e) {
      toast.error(e);
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetId]);

  return (
    <>
    <div className="overlay" style={{ background: "rgba(15,28,40,.18)", zIndex: 155 }} onClick={onClose} />
    <aside className="drawer" aria-label="Histórico">
      <div className="drawer-head">
        <History style={{ width: 18, color: "var(--text-3)" }} />
        <h2 style={{ flex: 1 }}>Histórico de alterações</h2>
        <button className="btn ghost icon sm" onClick={onClose} aria-label="Fechar">
          <X />
        </button>
      </div>
      <div className="drawer-body">
        {!events ? (
          <SkeletonRows n={5} />
        ) : !events.length ? (
          <Empty icon={<History />} title="Sem alterações registradas" />
        ) : (
          <>
            {events.map((e) => (
              <div key={e.seq} className="activity" style={{ cursor: e.details?.length ? "pointer" : undefined }} onClick={() => setOpenSeq(openSeq === e.seq ? null : e.seq)}>
                <span className={`dot ${e.source}`}>{e.source === "ai" ? "IA" : (e.userName ?? "S")[0]}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13 }}>{e.summary}</div>
                  <div className="muted small">
                    {e.userName ?? "Sistema"} · {SOURCE_LABEL[e.source]} · <span title={dateTime(e.at)}>{relTime(e.at)}</span>
                  </div>
                  {openSeq === e.seq && e.details && (
                    <div className="msg-table" style={{ marginTop: 8 }}>
                      <table>
                        <thead>
                          <tr>
                            <th>Campo</th>
                            <th>Antes</th>
                            <th>Depois</th>
                          </tr>
                        </thead>
                        <tbody>
                          {e.details.slice(0, 50).map((d, i) => (
                            <tr key={i}>
                              <td>{d.column ?? "linha"}</td>
                              <td>{fmtDetail(d.before)}</td>
                              <td>{fmtDetail(d.after)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {more && (
              <div style={{ padding: 14 }}>
                <button className="btn block" onClick={() => load(events[events.length - 1]?.seq)}>
                  Carregar mais
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </aside>
    </>
  );
}

function fmtDetail(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "object") return Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k}: ${x}`).join(" · ").slice(0, 160);
  return String(v).slice(0, 80);
}

// ------------------------------------------------------------------ celular: linhas em cartões

export function MobileRows({
  columns,
  rows,
  values,
  canEdit,
  year,
  onEdit,
  onAdd,
  onDelete,
  onError,
}: {
  columns: Column[];
  rows: SheetRecord[];
  values: Map<string, Record<string, Value>>;
  canEdit: boolean;
  year?: number;
  onEdit: (c: CellChange[]) => void;
  onAdd: () => Promise<SheetRecord | null>;
  onDelete: (id: string) => void;
  onError: (msg: string) => void;
}) {
  const [limit, setLimit] = useState(60);
  const [editing, setEditing] = useState<SheetRecord | null>(null);
  const key = useMemo(() => {
    const roles: ColumnRole[] = ["client", "worker", "amount", "status", "payment_date"];
    const picked = roles.map((r) => findRole(columns, r)).filter(Boolean) as Column[];
    return picked.length >= 2 ? picked : columns.filter((c) => !c.sensitive).slice(0, 4);
  }, [columns]);
  const title = key[0];
  return (
    <>
      <div className="row-cards">
        {rows.slice(0, limit).map((r) => {
          const vals = values.get(r.id) ?? {};
          return (
            <button key={r.id} className="card row-card" onClick={() => setEditing(r)}>
              <strong className="truncate">{formatCell(title, vals[title.id]) || "(sem nome)"}</strong>
              {key.slice(1).map((c) => (
                <div key={c.id} className="kv">
                  <span>{c.name}</span>
                  <span className="truncate" style={{ fontWeight: 500 }}>
                    {formatCell(c, vals[c.id]) || "—"}
                  </span>
                </div>
              ))}
            </button>
          );
        })}
        {rows.length > limit && (
          <button className="btn block" onClick={() => setLimit((l) => l + 100)}>
            Mostrar mais ({rows.length - limit})
          </button>
        )}
        {!rows.length && <Empty icon={<Search />} title="Nenhuma linha" text="Nada para mostrar com os filtros atuais." />}
      </div>
      {canEdit && (
        <button
          className="fab"
          style={{ right: 76 }}
          onClick={async () => {
            const r = await onAdd();
            if (r) setEditing(r);
          }}
          aria-label="Adicionar linha"
        >
          <Plus />
        </button>
      )}
      {editing && (
        <RowSheet
          record={rows.find((r) => r.id === editing.id) ?? editing}
          columns={columns}
          values={values.get(editing.id) ?? {}}
          canEdit={canEdit}
          year={year}
          onClose={() => setEditing(null)}
          onSave={(changes) => {
            onEdit(changes);
            setEditing(null);
          }}
          onDelete={() => {
            onDelete(editing.id);
            setEditing(null);
          }}
          onError={onError}
        />
      )}
    </>
  );
}

function RowSheet({
  record,
  columns,
  values,
  canEdit,
  year,
  onClose,
  onSave,
  onDelete,
  onError,
}: {
  record: SheetRecord;
  columns: Column[];
  values: Record<string, Value>;
  canEdit: boolean;
  year?: number;
  onClose: () => void;
  onSave: (c: CellChange[]) => void;
  onDelete: () => void;
  onError: (msg: string) => void;
}) {
  const [form, setForm] = useState<Record<string, string>>(() => Object.fromEntries(columns.map((c) => [c.id, editText(c, columns, record.data[c.id])])));
  function save() {
    const changes: CellChange[] = [];
    for (const c of columns) {
      if (c.type === "formula") continue;
      const before = editText(c, columns, record.data[c.id]);
      if (form[c.id] === before) continue;
      const res = toStored(c, columns, form[c.id], year);
      if (!res.ok) return onError(res.error);
      changes.push({ recordId: record.id, columnId: c.id, value: res.value });
    }
    onSave(changes);
  }
  return (
    <>
      <div className="overlay" style={{ zIndex: 165 }} onClick={onClose} />
      <div className="bottom-sheet" role="dialog" aria-label="Editar linha">
        <div className="grabber" />
        <div className="row" style={{ padding: "6px 16px 10px" }}>
          <h2 style={{ flex: 1 }}>{canEdit ? "Editar linha" : "Linha"}</h2>
          <button className="btn ghost icon sm" onClick={onClose} aria-label="Fechar">
            <X />
          </button>
        </div>
        <div className="stack" style={{ padding: "0 16px 16px", overflow: "auto" }}>
          {columns.map((c) =>
            c.type === "formula" ? (
              <div key={c.id} className="field">
                <span>{c.name} (calculada)</span>
                <div className="input" style={{ display: "flex", alignItems: "center", background: "var(--surface-2)" }}>
                  {formatCell(c, values[c.id])}
                </div>
              </div>
            ) : (
              <label key={c.id} className="field">
                <span>{c.name}</span>
                {c.type === "select" ? (
                  <select className="select" value={form[c.id]} disabled={!canEdit} onChange={(e) => setForm((f) => ({ ...f, [c.id]: e.target.value }))}>
                    <option value="">—</option>
                    {[...new Set([...(c.options ?? []), ...(form[c.id] ? [form[c.id]] : [])])].map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : c.type === "boolean" ? (
                  <select className="select" value={form[c.id]} disabled={!canEdit} onChange={(e) => setForm((f) => ({ ...f, [c.id]: e.target.value }))}>
                    <option value="">—</option>
                    <option value="Sim">Sim</option>
                    <option value="Não">Não</option>
                  </select>
                ) : (
                  <input
                    className="input"
                    value={form[c.id]}
                    disabled={!canEdit}
                    inputMode={c.type === "number" || c.type === "currency" ? "decimal" : undefined}
                    placeholder={c.type === "date" ? "dd/mm/aaaa" : undefined}
                    onChange={(e) => setForm((f) => ({ ...f, [c.id]: e.target.value }))}
                  />
                )}
              </label>
            ),
          )}
        </div>
        {canEdit && (
          <div className="row" style={{ padding: "12px 16px", borderTop: "1px solid var(--border)" }}>
            <button className="btn danger" onClick={onDelete}>
              <Trash2 /> Excluir
            </button>
            <span className="spacer" />
            <button className="btn" onClick={onClose}>
              Cancelar
            </button>
            <button className="btn primary" onClick={save}>
              Salvar
            </button>
          </div>
        )}
      </div>
    </>
  );
}
