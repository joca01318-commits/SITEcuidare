import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Copy,
  Download,
  FilePlus2,
  FileSpreadsheet,
  FileUp,
  LayoutGrid,
  List,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Search,
  Star,
  Trash2,
} from "lucide-react";
import type { ClientSummary, SpreadsheetSummary } from "../../../shared/types.js";
import { MONTHS_PT } from "../../../shared/types.js";
import { api, qs } from "../lib/api";
import { useDebounced, useIsMobile, useLoad } from "../lib/hooks";
import { useSession } from "../lib/session";
import { periodLabel, relTime } from "../lib/format";
import { Dialog, Empty, ErrorState, MenuButton, SkeletonRows, useConfirm, useToast } from "../components/ui";
import { ImportDialog, NewSheetDialog } from "../components/Dialogs";

function readPref(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writePref(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* sem armazenamento local */
  }
}

export function SpreadsheetsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const { can } = useSession();
  const isMobile = useIsMobile();
  const [q, setQ] = useState(params.get("q") ?? "");
  const dq = useDebounced(q, 200);
  const [view, setView] = useState<"list" | "grid">(() => (readPref("ci_view", "list") as "list" | "grid"));
  const [dialog, setDialog] = useState<"import" | "sheet" | null>(null);
  const [renaming, setRenaming] = useState<SpreadsheetSummary | null>(null);
  const filters = {
    clientId: params.get("cliente") ?? "",
    year: params.get("ano") ?? "",
    month: params.get("mes") ?? "",
    category: params.get("categoria") ?? "",
    favorites: params.get("favoritas") === "1",
    trash: params.get("lixeira") === "1",
    sort: (params.get("ordem") ?? "updated") as "updated" | "title" | "period",
  };
  const setFilter = (k: string, v: string | null) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    setParams(p, { replace: true });
  };

  const { data, error, loading, reload, setData } = useLoad(
    () =>
      api.get<{ spreadsheets: SpreadsheetSummary[] }>(
        `/api/spreadsheets${qs({ q: dq, clientId: filters.clientId, year: filters.year, month: filters.month, category: filters.category, favorites: filters.favorites, trash: filters.trash, sort: filters.sort })}`,
      ),
    [dq, filters.clientId, filters.year, filters.month, filters.category, filters.favorites, filters.trash, filters.sort],
  );
  const { data: clientsData } = useLoad(() => api.get<{ clients: ClientSummary[] }>("/api/clients"), []);
  const [allSheets, setAllSheets] = useState<SpreadsheetSummary[]>([]);
  useEffect(() => {
    api.get<{ spreadsheets: SpreadsheetSummary[] }>("/api/spreadsheets").then((r) => setAllSheets(r.spreadsheets)).catch(() => {});
  }, []);
  const years = useMemo(() => [...new Set(allSheets.map((s) => s.year).filter(Boolean) as number[])].sort((a, b) => b - a), [allSheets]);
  const categories = useMemo(() => [...new Set(allSheets.map((s) => s.category))].sort(), [allSheets]);

  const sheets = data?.spreadsheets ?? [];

  async function toggleFav(s: SpreadsheetSummary) {
    setData((d) => d && { spreadsheets: d.spreadsheets.map((x) => (x.id === s.id ? { ...x, favorite: !x.favorite } : x)) });
    try {
      await api.put(`/api/spreadsheets/${s.id}/favorite`, { on: !s.favorite });
    } catch (e) {
      toast.error(e);
      reload();
    }
  }

  async function duplicate(s: SpreadsheetSummary) {
    try {
      const r = await api.post<{ id: string }>(`/api/spreadsheets/${s.id}/duplicate`, {});
      toast.success("Cópia criada.");
      navigate(`/planilhas/${r.id}`);
    } catch (e) {
      toast.error(e);
    }
  }

  async function remove(s: SpreadsheetSummary) {
    if (!(await confirm({ title: "Mover para a lixeira?", text: `“${s.title}” vai para a lixeira e pode ser recuperada por 30 dias.`, confirm: "Mover para a lixeira", danger: true }))) return;
    try {
      await api.del(`/api/spreadsheets/${s.id}`);
      toast.success("Planilha movida para a lixeira.", {
        label: "Desfazer",
        run: () => void api.post(`/api/spreadsheets/${s.id}/restore`).then(reload),
      });
      reload();
    } catch (e) {
      toast.error(e);
    }
  }

  async function restore(s: SpreadsheetSummary) {
    try {
      await api.post(`/api/spreadsheets/${s.id}/restore`);
      toast.success("Planilha recuperada.");
      reload();
    } catch (e) {
      toast.error(e);
    }
  }

  const menu = (s: SpreadsheetSummary) =>
    filters.trash
      ? [{ label: "Recuperar", icon: <RotateCcw />, onSelect: () => void restore(s) }]
      : [
          { label: "Abrir", icon: <FileSpreadsheet />, onSelect: () => navigate(`/planilhas/${s.id}`) },
          ...(can("edit")
            ? [
                { label: "Renomear", icon: <Pencil />, onSelect: () => setRenaming(s) },
                { label: "Duplicar", icon: <Copy />, onSelect: () => void duplicate(s) },
              ]
            : []),
          { label: "Baixar Excel", icon: <Download />, onSelect: () => void api.download(`/api/spreadsheets/${s.id}/export?format=xlsx`).catch(toast.error) },
          { label: "Baixar PDF", icon: <Download />, onSelect: () => void api.download(`/api/spreadsheets/${s.id}/export?format=pdf`).catch(toast.error) },
          ...(can("delete") ? [{ divider: true, label: "" }, { label: "Mover para a lixeira", icon: <Trash2 />, danger: true, onSelect: () => void remove(s) }] : []),
        ];

  const effectiveView = isMobile ? "list" : view;
  const anyFilter = filters.clientId || filters.year || filters.month || filters.category || filters.favorites || dq;

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ flex: 1 }}>
          <h1>{filters.trash ? "Lixeira" : "Planilhas"}</h1>
          <p className="sub">{filters.trash ? "Planilhas excluídas ficam aqui por 30 dias." : "Todas as planilhas da Cuidare, organizadas por cliente, mês e categoria."}</p>
        </div>
        {can("edit") && !filters.trash && (
          <div className="row">
            <button className="btn" onClick={() => setDialog("import")}>
              <FileUp /> Importar
            </button>
            <button className="btn primary" onClick={() => setDialog("sheet")}>
              <FilePlus2 /> Nova
            </button>
          </div>
        )}
      </div>

      <div className="toolbar">
        <div className="input-icon">
          <Search />
          <input className="input" placeholder="Buscar por nome, cliente ou mês…" value={q} onChange={(e) => setQ(e.target.value)} style={{ height: 36 }} aria-label="Buscar planilhas" />
        </div>
        <select className="select" value={filters.clientId} onChange={(e) => setFilter("cliente", e.target.value)} aria-label="Cliente">
          <option value="">Todos os clientes</option>
          {clientsData?.clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select className="select" value={filters.month} onChange={(e) => setFilter("mes", e.target.value)} aria-label="Mês">
          <option value="">Qualquer mês</option>
          {MONTHS_PT.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
        <select className="select" value={filters.year} onChange={(e) => setFilter("ano", e.target.value)} aria-label="Ano">
          <option value="">Qualquer ano</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        {categories.length > 1 && (
          <select className="select" value={filters.category} onChange={(e) => setFilter("categoria", e.target.value)} aria-label="Categoria">
            <option value="">Todas as categorias</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
        <select className="select" value={filters.sort} onChange={(e) => setFilter("ordem", e.target.value === "updated" ? null : e.target.value)} aria-label="Ordenar">
          <option value="updated">Atualizadas recentemente</option>
          <option value="period">Por período</option>
          <option value="title">Por nome</option>
        </select>
        <button className={`btn ${filters.favorites ? "primary" : ""}`} onClick={() => setFilter("favoritas", filters.favorites ? null : "1")} aria-pressed={filters.favorites}>
          <Star /> Favoritas
        </button>
        <div className="spacer" />
        {!isMobile && (
          <div className="segmented" role="group" aria-label="Visualização">
            <button aria-pressed={view === "list"} onClick={() => (setView("list"), writePref("ci_view", "list"))} aria-label="Lista">
              <List />
            </button>
            <button aria-pressed={view === "grid"} onClick={() => (setView("grid"), writePref("ci_view", "grid"))} aria-label="Grade">
              <LayoutGrid />
            </button>
          </div>
        )}
        {can("delete") && (
          <button className="btn ghost" onClick={() => setFilter("lixeira", filters.trash ? null : "1")}>
            <Trash2 /> {filters.trash ? "Sair da lixeira" : "Lixeira"}
          </button>
        )}
      </div>

      {error ? (
        <ErrorState error={error} retry={reload} />
      ) : loading && !data ? (
        <div className="card">
          <SkeletonRows n={6} />
        </div>
      ) : !sheets.length ? (
        <div className="card">
          {anyFilter ? (
            <Empty icon={<Search />} title="Nenhuma planilha encontrada" text="Tente outros filtros ou limpe a busca.">
              <button className="btn" onClick={() => (setQ(""), setParams(new URLSearchParams(), { replace: true }))}>
                Limpar filtros
              </button>
            </Empty>
          ) : filters.trash ? (
            <Empty icon={<Trash2 />} title="A lixeira está vazia" />
          ) : (
            <Empty icon={<FileSpreadsheet />} title="Nenhuma planilha ainda" text="Importe os arquivos do Excel ou crie uma planilha do zero.">
              {can("edit") && (
                <div className="row">
                  <button className="btn primary" onClick={() => setDialog("import")}>
                    <FileUp /> Importar do Excel
                  </button>
                  <button className="btn" onClick={() => setDialog("sheet")}>
                    <FilePlus2 /> Criar planilha
                  </button>
                </div>
              )}
            </Empty>
          )}
        </div>
      ) : effectiveView === "list" ? (
        <div className="card" style={{ overflow: "hidden" }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 36 }} />
                <th>Nome</th>
                <th className="hide-sm">Período</th>
                <th className="hide-sm">Categoria</th>
                <th className="hide-sm num">Linhas</th>
                <th className="hide-sm">Atualizada</th>
                <th style={{ width: 44 }} />
              </tr>
            </thead>
            <tbody>
              {sheets.map((s) => (
                <tr key={s.id} className="clickable" onClick={() => !filters.trash && navigate(`/planilhas/${s.id}${qs({ cliente: filters.clientId })}`)}>
                  <td onClick={(e) => e.stopPropagation()}>
                    {!filters.trash && (
                      <button className={`star ${s.favorite ? "on" : ""}`} onClick={() => toggleFav(s)} aria-label={s.favorite ? "Remover dos favoritos" : "Favoritar"}>
                        <Star />
                      </button>
                    )}
                  </td>
                  <td>
                    <div className="row" style={{ gap: 10 }}>
                      <span className="file-icon hide-mobile">
                        <FileSpreadsheet />
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <Link to={`/planilhas/${s.id}${qs({ cliente: filters.clientId })}`} className="item-title" style={{ color: "inherit" }} onClick={(e) => e.stopPropagation()}>
                          {s.title}
                        </Link>
                        <div className="item-sub">
                          {s.clientName ? `${s.clientName} · ` : ""}
                          {s.sourceFormat ? <span className="badge" style={{ height: 18, fontSize: 10.5 }}>{s.sourceFormat.toUpperCase()}</span> : <span className="badge brand" style={{ height: 18, fontSize: 10.5 }}>Criada aqui</span>}
                          <span className="only-mobile"> · {periodLabel(s.month, s.year)}</span>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="hide-sm">{periodLabel(s.month, s.year)}</td>
                  <td className="hide-sm">
                    <span className="badge">{s.category}</span>
                  </td>
                  <td className="hide-sm num">{s.rowCount.toLocaleString("pt-BR")}</td>
                  <td className="hide-sm muted small" title={s.updatedAt}>
                    {relTime(s.updatedAt)}
                    {s.updatedByName ? ` · ${s.updatedByName.split(" ")[0]}` : ""}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <MenuButton className="btn ghost icon sm" label="Ações" items={menu(s)} align="end">
                      <MoreHorizontal />
                    </MenuButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="sheet-cards">
          {sheets.map((s) => (
            <div key={s.id} className="card sheet-card" onClick={() => !filters.trash && navigate(`/planilhas/${s.id}${qs({ cliente: filters.clientId })}`)} role="link" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && navigate(`/planilhas/${s.id}`)}>
              <div className="row">
                <span className="file-icon">
                  <FileSpreadsheet />
                </span>
                <span className="spacer" />
                <span onClick={(e) => e.stopPropagation()} className="row" style={{ gap: 2 }}>
                  {!filters.trash && (
                    <button className={`star ${s.favorite ? "on" : ""}`} onClick={() => toggleFav(s)} aria-label="Favoritar">
                      <Star />
                    </button>
                  )}
                  <MenuButton className="btn ghost icon sm" label="Ações" items={menu(s)} align="end">
                    <MoreHorizontal />
                  </MenuButton>
                </span>
              </div>
              <div>
                <div className="item-title">{s.title}</div>
                <div className="item-sub">{periodLabel(s.month, s.year)}</div>
              </div>
              <div className="meta">
                <span className="badge">{s.category}</span>
                {s.clientName && <span className="badge success">{s.clientName}</span>}
                <span className="badge">{s.rowCount} linhas</span>
              </div>
              <div className="muted small">Atualizada {relTime(s.updatedAt)}</div>
            </div>
          ))}
        </div>
      )}

      {dialog === "import" && <ImportDialog onClose={() => (setDialog(null), reload())} />}
      {dialog === "sheet" && <NewSheetDialog onClose={() => setDialog(null)} defaultClientId={filters.clientId || undefined} />}
      {renaming && <RenameDialog sheet={renaming} onClose={() => setRenaming(null)} onDone={() => (setRenaming(null), reload())} />}
    </div>
  );
}

function RenameDialog({ sheet, onClose, onDone }: { sheet: SpreadsheetSummary; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState(sheet.title);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <Dialog
      title="Renomear planilha"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="btn primary"
            disabled={busy || !title.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await api.patch(`/api/spreadsheets/${sheet.id}`, { title });
                onDone();
              } catch (e) {
                toast.error(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            Salvar
          </button>
        </>
      }
    >
      <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} aria-label="Nome" />
    </Dialog>
  );
}
