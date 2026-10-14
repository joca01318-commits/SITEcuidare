import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, FileUp, Info, UploadCloud } from "lucide-react";
import type { ClientSummary, Column, RowData, SpreadsheetSummary } from "../../../shared/types.js";
import { MONTHS_PT } from "../../../shared/types.js";
import { COLUMN_TYPE_LABEL, formatCell } from "../../../shared/columns.js";
import { api } from "../lib/api";
import { Dialog, Spinner, useToast } from "./ui";

const CURRENT_YEAR = new Date().getFullYear();

// ------------------------------------------------------------------ cliente

export function ClientDialog({ client, onClose, onSaved }: { client?: ClientSummary; onClose: () => void; onSaved: (c: ClientSummary) => void }) {
  const [name, setName] = useState(client?.name ?? "");
  const [aliases, setAliases] = useState((client?.aliases ?? []).join(", "));
  const [notes, setNotes] = useState(client?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = { name, aliases: aliases.split(",").map((a) => a.trim()).filter(Boolean), notes: notes || null };
    try {
      const r = client ? await api.patch<{ client: ClientSummary }>(`/api/clients/${client.id}`, body) : await api.post<{ client: ClientSummary }>("/api/clients", body);
      onSaved(r.client);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={client ? "Editar cliente" : "Novo cliente"}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn primary" form="client-form" disabled={busy || !name.trim()}>
            {busy ? "Salvando…" : "Salvar"}
          </button>
        </>
      }
    >
      <form id="client-form" className="stack" onSubmit={submit}>
        <label className="field">
          <span>Nome do cliente (assistido)</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={160} placeholder="Ex.: Dinaldo" />
        </label>
        <label className="field">
          <span>Outros nomes / apelidos</span>
          <input className="input" value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder="Ex.: Seu Dinaldo, José Dinaldo" />
          <span className="hint">Separe por vírgula. Ajuda a assistente e a importação a reconhecerem o cliente.</span>
        </label>
        <label className="field">
          <span>Observações</span>
          <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
          <span className="hint">Evite dados de saúde ou documentos que não sejam necessários (LGPD).</span>
        </label>
        {error && <p className="error-text">{error}</p>}
      </form>
    </Dialog>
  );
}

// ------------------------------------------------------------------ nova planilha

export function NewSheetDialog({ onClose, defaultClientId, templateId }: { onClose: () => void; defaultClientId?: string; templateId?: string }) {
  const navigate = useNavigate();
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [sheets, setSheets] = useState<SpreadsheetSummary[]>([]);
  const now = new Date();
  const [form, setForm] = useState({
    title: "",
    category: "",
    clientId: defaultClientId ?? "",
    month: String(now.getMonth() + 1),
    year: String(now.getFullYear()),
    templateId: templateId ?? "",
    copyRows: "carry" as "none" | "carry" | "all",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ clients: ClientSummary[] }>("/api/clients").then((r) => setClients(r.clients)).catch(() => {});
    api.get<{ spreadsheets: SpreadsheetSummary[] }>("/api/spreadsheets?sort=period").then((r) => setSheets(r.spreadsheets)).catch(() => {});
  }, []);

  const template = sheets.find((s) => s.id === form.templateId);
  useEffect(() => {
    if (template && !form.title) {
      const next = Number(form.month);
      const t = template.month ? template.title.replace(new RegExp(MONTHS_PT[template.month - 1], "i"), (m) => (m === m.toUpperCase() ? MONTHS_PT[next - 1].toUpperCase() : MONTHS_PT[next - 1])) : template.title;
      setForm((f) => ({ ...f, title: t === template.title ? `${template.title} - ${MONTHS_PT[next - 1]}` : t, category: f.category || template.category }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.templateId]);

  const categories = [...new Set(sheets.map((s) => s.category))];
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ id: string }>("/api/spreadsheets", {
        title: form.title,
        category: form.category || undefined,
        clientId: form.clientId || null,
        month: form.month ? Number(form.month) : null,
        year: form.year ? Number(form.year) : null,
        templateId: form.templateId || undefined,
        copyRows: form.templateId ? form.copyRows : undefined,
      });
      navigate(`/planilhas/${r.id}`);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title="Nova planilha"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn primary" form="new-sheet" disabled={busy || !form.title.trim()}>
            {busy ? "Criando…" : "Criar planilha"}
          </button>
        </>
      }
    >
      <form id="new-sheet" className="stack" onSubmit={submit}>
        <label className="field">
          <span>Basear em uma planilha existente (opcional)</span>
          <select className="select" value={form.templateId} onChange={set("templateId")}>
            <option value="">Começar do zero</option>
            {sheets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
                {s.month || s.year ? ` · ${s.month ? MONTHS_PT[s.month - 1] : ""} ${s.year ?? ""}` : ""}
              </option>
            ))}
          </select>
        </label>
        {form.templateId && (
          <div className="field">
            <span>O que copiar</span>
            <div className="segmented" role="group">
              {(
                [
                  ["carry", "Linhas fixas"],
                  ["none", "Só a estrutura"],
                  ["all", "Tudo"],
                ] as const
              ).map(([v, l]) => (
                <button type="button" key={v} aria-pressed={form.copyRows === v} onClick={() => setForm((f) => ({ ...f, copyRows: v }))}>
                  {l}
                </button>
              ))}
            </div>
            <span className="hint">
              {form.copyRows === "carry"
                ? "Copia as linhas mantendo cliente, cuidador, regime, turno, valor do plantão e chave PIX; o resto começa vazio."
                : form.copyRows === "none"
                  ? "Só as colunas, sem linhas."
                  : "Cópia completa, com todos os valores."}
            </span>
          </div>
        )}
        <label className="field">
          <span>Nome</span>
          <input className="input" value={form.title} onChange={set("title")} required maxLength={200} placeholder="Ex.: Controle Escala - Novembro" />
        </label>
        <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
          <label className="field" style={{ flex: 1 }}>
            <span>Mês</span>
            <select className="select" value={form.month} onChange={set("month")}>
              <option value="">—</option>
              {MONTHS_PT.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="field" style={{ width: 110 }}>
            <span>Ano</span>
            <input className="input" type="number" min={2000} max={2100} value={form.year} onChange={set("year")} />
          </label>
        </div>
        <label className="field">
          <span>Categoria</span>
          <input className="input" list="cat-list" value={form.category} onChange={set("category")} placeholder="Ex.: Controle de pagamentos" maxLength={80} />
          <datalist id="cat-list">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <label className="field">
          <span>Cliente (se a planilha for de um cliente só)</span>
          <select className="select" value={form.clientId} onChange={set("clientId")}>
            <option value="">Planilha geral (vários clientes)</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {error && <p className="error-text">{error}</p>}
      </form>
    </Dialog>
  );
}

// ------------------------------------------------------------------ importação

interface PreviewSheet {
  index: number;
  name: string;
  title: string;
  month: number | null;
  year: number | null;
  hidden: boolean;
  columns: Column[];
  clientColumn: string | null;
  notes: string[];
  stats: { rows: number; emptyRowsRemoved: number; formulasKept: number; formulasLost: number; clientsDetected: number };
  sample: RowData[];
}

interface Preview {
  format: string;
  workbook: string;
  category: string;
  sheets: PreviewSheet[];
}

interface Choice {
  index: number;
  include: boolean;
  title: string;
  year: number | null;
  month: number | null;
  clientColumn: string | null;
  clientId: string | null;
}

export function ImportDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [stage, setStage] = useState<"pick" | "uploading" | "review" | "saving">("pick");
  const [error, setError] = useState<string | null>(null);
  const [fileId, setFileId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [duplicateOf, setDuplicateOf] = useState<string | null>(null);
  const [category, setCategory] = useState("");
  const [choices, setChoices] = useState<Choice[]>([]);
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [open, setOpen] = useState<number | null>(0);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get<{ clients: ClientSummary[] }>("/api/clients").then((r) => setClients(r.clients)).catch(() => {});
  }, []);

  async function upload(file: File) {
    setError(null);
    if (!/\.(xlsx|xlsm|csv|txt)$/i.test(file.name)) {
      setError(/\.xls$/i.test(file.name) ? 'Arquivos .xls antigos não são suportados. No Excel, use "Salvar como" → .xlsx.' : "Envie um arquivo Excel (.xlsx) ou CSV.");
      return;
    }
    setStage("uploading");
    const fd = new FormData();
    fd.append("file", file);
    try {
      const r = await api.post<{ fileId: string; preview: Preview; duplicateOf: string | null }>("/api/imports", fd);
      setFileId(r.fileId);
      setPreview(r.preview);
      setDuplicateOf(r.duplicateOf);
      setCategory(r.preview.category);
      setChoices(
        r.preview.sheets.map((s) => ({
          index: s.index,
          include: s.stats.rows > 0 && !s.hidden,
          title: s.title,
          month: s.month,
          year: s.year ?? (s.month ? CURRENT_YEAR : null),
          clientColumn: s.clientColumn,
          clientId: null,
        })),
      );
      setStage("review");
    } catch (e) {
      setError((e as Error).message);
      setStage("pick");
    }
  }

  async function commit() {
    if (!fileId) return;
    setStage("saving");
    try {
      const r = await api.post<{ created: { id: string; title: string; rows: number }[] }>(`/api/imports/${fileId}/commit`, { category, sheets: choices });
      toast.success(`${r.created.length} planilha(s) importada(s).`);
      onClose();
      if (r.created.length === 1) navigate(`/planilhas/${r.created[0].id}`);
      else navigate(`/planilhas?importado=${fileId}`);
    } catch (e) {
      setError((e as Error).message);
      setStage("review");
    }
  }

  const update = (i: number, patch: Partial<Choice>) => setChoices((cs) => cs.map((c) => (c.index === i ? { ...c, ...patch } : c)));
  const included = choices.filter((c) => c.include).length;

  return (
    <Dialog
      wide
      title={preview ? `Importar “${preview.workbook}”` : "Importar planilha"}
      onClose={onClose}
      icon={<FileUp style={{ width: 20, color: "var(--accent)" }} />}
      footer={
        stage === "review" || stage === "saving" ? (
          <>
            <span className="muted small" style={{ marginRight: "auto" }}>
              {included} de {choices.length} aba(s) selecionada(s)
            </span>
            <button className="btn" onClick={onClose}>
              Cancelar
            </button>
            <button className="btn primary" onClick={commit} disabled={!included || stage === "saving"}>
              {stage === "saving" ? "Importando…" : `Importar ${included} planilha(s)`}
            </button>
          </>
        ) : undefined
      }
    >
      {(stage === "pick" || stage === "uploading") && (
        <div className="stack">
          <div
            className="card"
            style={{
              borderStyle: "dashed",
              borderWidth: 2,
              borderColor: drag ? "var(--accent)" : "var(--border-strong)",
              background: drag ? "var(--brand-50)" : "var(--surface-2)",
              padding: "40px 20px",
              textAlign: "center",
              cursor: "pointer",
            }}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              const f = e.dataTransfer.files[0];
              if (f) void upload(f);
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
          >
            {stage === "uploading" ? (
              <Spinner label="Lendo o arquivo…" />
            ) : (
              <>
                <UploadCloud style={{ width: 34, height: 34, color: "var(--accent)" }} />
                <h3 style={{ marginTop: 10 }}>Arraste o arquivo aqui ou clique para escolher</h3>
                <p className="muted small" style={{ marginTop: 4 }}>
                  Excel (.xlsx) ou CSV. Cada aba vira uma planilha. Você revisa tudo antes de importar.
                </p>
              </>
            )}
            <input
              ref={inputRef}
              type="file"
              hidden
              accept=".xlsx,.xlsm,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
                e.target.value = "";
              }}
            />
          </div>
          {error && (
            <div className="banner danger">
              <AlertTriangle />
              {error}
            </div>
          )}
        </div>
      )}

      {(stage === "review" || stage === "saving") && preview && (
        <div className="stack">
          {duplicateOf && (
            <div className="banner warning">
              <AlertTriangle />
              <span>
                Este mesmo arquivo já foi importado antes (planilha “{duplicateOf}”). Importar de novo cria cópias.
              </span>
            </div>
          )}
          <label className="field">
            <span>Categoria</span>
            <input className="input" value={category} onChange={(e) => setCategory(e.target.value)} maxLength={80} />
          </label>
          {preview.sheets.map((s) => {
            const c = choices.find((x) => x.index === s.index)!;
            const isOpen = open === s.index;
            return (
              <div key={s.index} className="card" style={{ overflow: "hidden" }}>
                <div className="row" style={{ padding: "12px 14px", gap: 12 }}>
                  <input type="checkbox" checked={c.include} onChange={(e) => update(s.index, { include: e.target.checked })} aria-label={`Importar ${s.name}`} style={{ width: 17, height: 17, accentColor: "var(--brand)" }} />
                  <button className="btn ghost sm icon" onClick={() => setOpen(isOpen ? null : s.index)} aria-label="Detalhes">
                    {isOpen ? <ChevronDown /> : <ChevronRight />}
                  </button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="item-title truncate">{s.name}</div>
                    <div className="muted small">
                      {s.stats.rows} linhas · {s.columns.length} colunas
                      {s.stats.clientsDetected ? ` · ${s.stats.clientsDetected} clientes` : ""}
                      {s.stats.formulasKept ? ` · ${s.stats.formulasKept} fórmulas mantidas` : ""}
                    </div>
                  </div>
                  {s.notes.length > 0 ? (
                    <span className="badge warning">
                      <Info /> {s.notes.length} aviso(s)
                    </span>
                  ) : (
                    <span className="badge success">
                      <CheckCircle2 /> sem perdas
                    </span>
                  )}
                </div>
                {isOpen && (
                  <div className="stack" style={{ padding: "0 14px 14px", borderTop: "1px solid var(--border)", paddingTop: 14 }}>
                    <div className="row wrap" style={{ gap: 12, alignItems: "flex-end" }}>
                      <label className="field" style={{ flex: "2 1 220px" }}>
                        <span>Nome da planilha</span>
                        <input className="input" value={c.title} onChange={(e) => update(s.index, { title: e.target.value })} />
                      </label>
                      <label className="field" style={{ flex: "1 1 120px" }}>
                        <span>Mês</span>
                        <select className="select" value={c.month ?? ""} onChange={(e) => update(s.index, { month: e.target.value ? Number(e.target.value) : null })}>
                          <option value="">—</option>
                          {MONTHS_PT.map((m, i) => (
                            <option key={m} value={i + 1}>
                              {m}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field" style={{ width: 100 }}>
                        <span>Ano</span>
                        <input className="input" type="number" value={c.year ?? ""} onChange={(e) => update(s.index, { year: e.target.value ? Number(e.target.value) : null })} />
                      </label>
                    </div>
                    <div className="row wrap" style={{ gap: 12, alignItems: "flex-end" }}>
                      <label className="field" style={{ flex: "1 1 220px" }}>
                        <span>Coluna que identifica o cliente</span>
                        <select className="select" value={c.clientColumn ?? ""} onChange={(e) => update(s.index, { clientColumn: e.target.value || null })}>
                          <option value="">Nenhuma</option>
                          {s.columns.map((col) => (
                            <option key={col.id} value={col.id}>
                              {col.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      {!c.clientColumn && (
                        <label className="field" style={{ flex: "1 1 220px" }}>
                          <span>Ou vincular a planilha inteira a um cliente</span>
                          <select className="select" value={c.clientId ?? ""} onChange={(e) => update(s.index, { clientId: e.target.value || null })}>
                            <option value="">Nenhum</option>
                            {clients.map((cl) => (
                              <option key={cl.id} value={cl.id}>
                                {cl.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                    </div>
                    {s.notes.length > 0 && (
                      <div className="banner">
                        <Info />
                        <ul style={{ margin: 0, paddingLeft: 16 }}>
                          {s.notes.map((n, i) => (
                            <li key={i}>{n}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div className="row wrap" style={{ gap: 6 }}>
                      {s.columns.map((col) => (
                        <span key={col.id} className="badge" title={COLUMN_TYPE_LABEL[col.type]}>
                          {col.name} · {COLUMN_TYPE_LABEL[col.type]}
                          {col.sensitive ? " · 🔒" : ""}
                        </span>
                      ))}
                    </div>
                    {s.sample.length > 0 && (
                      <div className="msg-table" style={{ maxHeight: 220 }}>
                        <table>
                          <thead>
                            <tr>
                              {s.columns.slice(0, 10).map((col) => (
                                <th key={col.id}>{col.name}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {s.sample.slice(0, 5).map((r, i) => (
                              <tr key={i}>
                                {s.columns.slice(0, 10).map((col) => (
                                  <td key={col.id}>{col.sensitive ? "••••" : String(r[col.id] ?? "").startsWith("=") ? "ƒ" : formatCell(col, r[col.id] ?? null)}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          <p className="muted small">O arquivo original fica guardado com segurança e pode ser baixado depois na própria planilha.</p>
          {error && (
            <div className="banner danger">
              <AlertTriangle />
              {error}
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
