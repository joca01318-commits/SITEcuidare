import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowDownAZ,
  ArrowLeft,
  ArrowUpAZ,
  CheckCircle2,
  CloudOff,
  Columns3,
  Copy,
  Download,
  FileDown,
  FilePlus2,
  Filter,
  History,
  Info,
  Link2,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  Star,
  Trash2,
  X,
} from "lucide-react";
import type { CellConflict, Column, SheetRecord } from "../../../shared/types.js";
import { MONTHS_PT } from "../../../shared/types.js";
import { formatCell, isNumericColumn } from "../../../shared/columns.js";
import { computeRow, FormulaError, type Value } from "../../../shared/formula.js";
import { formatMoney, formatNumber, normalize, sumMoney } from "../../../shared/text.js";
import { api } from "../lib/api";
import { useDebounced, useIsMobile } from "../lib/hooks";
import { useAssistant, useSession } from "../lib/session";
import { periodLabel, relTime } from "../lib/format";
import { useSheet, type SaveState } from "../lib/useSheet";
import { Grid } from "../components/Grid";
import { ColumnDialog, FilterDialog, HistoryDrawer, MobileRows, VersionsDrawer } from "../components/SheetParts";
import { NewSheetDialog } from "../components/Dialogs";
import { Dialog, ErrorState, Menu, MenuButton, useConfirm, useToast, type MenuItem } from "../components/ui";

function SaveIndicator({ state, pending }: { state: SaveState; pending: number }) {
  if (state === "offline")
    return (
      <span className="save-state error" title="As alterações ficam guardadas neste aparelho e são enviadas quando a conexão voltar.">
        <CloudOff /> Sem conexão · {pending} pendente(s)
      </span>
    );
  if (state === "error")
    return (
      <span className="save-state error">
        <AlertTriangle /> Erro ao salvar{pending ? ` · tentando de novo (${pending})` : ""}
      </span>
    );
  if (state === "saving" || pending)
    return (
      <span className="save-state">
        <Loader2 style={{ animation: "spin 1s linear infinite" }} /> Salvando…
      </span>
    );
  if (state === "saved")
    return (
      <span className="save-state saved">
        <CheckCircle2 /> Salvo
      </span>
    );
  return (
    <span className="save-state">
      <CheckCircle2 /> Tudo salvo
    </span>
  );
}

type ColFilter = Set<string>;

/** Ordem dos totais no celular: valor pago primeiro. */
function rank(c: Column | undefined): number {
  const order = ["amount", "unit_value", "quantity", "absences"];
  const i = order.indexOf(c?.role ?? "");
  return i < 0 ? 9 : i;
}

export function SpreadsheetPage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const clientId = params.get("cliente");
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const isMobile = useIsMobile();
  const { me, can } = useSession();
  const assistant = useAssistant();

  const onConflict = useCallback(
    (cs: CellConflict[]) => {
      const c = cs[0];
      toast.info(`${c.byName ?? "Outra pessoa"} alterou esta célula antes de você. Mantive o valor dela${cs.length > 1 ? ` (${cs.length} células)` : ""}.`, {
        label: "Usar o meu",
        run: () => cs.forEach((x) => sheet.forceValue(x)),
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [toast],
  );
  const sheet = useSheet(id, clientId, {
    myId: me?.id ?? "",
    onConflict,
    onError: (m) => toast.error(m),
    onRemote: (name, what) => toast.info(`${name} ${what}.`),
  });
  const { detail } = sheet;

  const [q, setQ] = useState("");
  const dq = useDebounced(q, 150);
  const [sort, setSort] = useState<{ colId: string; dir: "asc" | "desc" } | null>(null);
  const [filters, setFilters] = useState<Map<string, ColFilter>>(new Map());
  const [colMenu, setColMenu] = useState<{ col: Column; anchor: HTMLElement } | null>(null);
  const [colDialog, setColDialog] = useState<{ col: Column | null } | null>(null);
  const [filterDialog, setFilterDialog] = useState<Column | null>(null);
  const [drawer, setDrawer] = useState<"versions" | "history" | null>(null);
  const [selStats, setSelStats] = useState<{ sum: number; count: number; cells: number } | null>(null);
  const [notesOpen, setNotesOpen] = useState(true);
  const [metaOpen, setMetaOpen] = useState(false);
  const [nextMonth, setNextMonth] = useState(false);
  const [title, setTitle] = useState("");

  useEffect(() => {
    if (detail) setTitle(detail.title);
  }, [detail?.title]); // eslint-disable-line react-hooks/exhaustive-deps

  // A assistente sabe qual planilha está aberta ("esta planilha").
  useEffect(() => {
    assistant.setPage({ spreadsheetId: id, clientId });
    return () => assistant.setPage({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, clientId]);

  // Quando a assistente altera dados, a grade recarrega.
  useEffect(() => {
    if (assistant.changed) void sheet.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistant.changed]);

  const columns = detail?.columns ?? [];
  const values = useMemo(() => {
    const m = new Map<string, Record<string, Value>>();
    for (const r of detail?.records ?? []) m.set(r.id, computeRow(r.data, columns));
    return m;
  }, [detail?.records, columns]);

  const statusCol = columns.find((c) => c.role === "status");
  const onlyPending = params.get("status") === "pendente" && !!statusCol?.pendingValues?.length;

  const rows = useMemo(() => {
    let list = detail?.records ?? [];
    if (onlyPending && statusCol) {
      const p = new Set(statusCol.pendingValues!.map(normalize));
      list = list.filter((r) => typeof r.data[statusCol.id] === "string" && p.has(normalize(String(r.data[statusCol.id]))));
    }
    for (const [colId, allowed] of filters) {
      const col = columns.find((c) => c.id === colId);
      if (!col) continue;
      list = list.filter((r) => allowed.has(formatCell(col, values.get(r.id)?.[colId] ?? null)));
    }
    if (dq.trim()) {
      const words = normalize(dq).split(" ").filter(Boolean);
      list = list.filter((r) => {
        const vals = values.get(r.id) ?? {};
        const hay = normalize(columns.map((c) => (c.sensitive ? "" : formatCell(c, vals[c.id]))).join(" "));
        return words.every((w) => hay.includes(w));
      });
    }
    if (sort) {
      const col = columns.find((c) => c.id === sort.colId);
      if (col) {
        const dir = sort.dir === "asc" ? 1 : -1;
        list = [...list].sort((a, b) => {
          const va = values.get(a.id)?.[col.id];
          const vb = values.get(b.id)?.[col.id];
          const ea = va === null || va === undefined || va === "";
          const eb = vb === null || vb === undefined || vb === "";
          if (ea && eb) return 0;
          if (ea) return 1;
          if (eb) return -1;
          if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
          return String(va instanceof FormulaError ? va.code : va).localeCompare(String(vb instanceof FormulaError ? vb.code : vb), "pt-BR", { numeric: true }) * dir;
        });
      }
    }
    return list;
  }, [detail?.records, filters, dq, sort, columns, values, onlyPending, statusCol]);

  const totals = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of columns) {
      if (!isNumericColumn(c) && c.role !== "amount") continue;
      const nums: number[] = [];
      for (const r of rows) {
        const v = values.get(r.id)?.[c.id];
        if (typeof v === "number") nums.push(v);
      }
      if (!nums.length) continue;
      const currency = c.type === "currency" || c.role === "amount" || c.role === "unit_value";
      m.set(c.id, currency ? formatMoney(sumMoney(nums)) : formatNumber(nums.reduce((s, n) => s + n, 0)));
    }
    return m;
  }, [columns, rows, values]);

  const canEdit = !!detail?.canEdit;
  const filtered = new Set(filters.keys());

  async function saveTitle() {
    if (!detail || !title.trim() || title === detail.title) return setTitle(detail?.title ?? "");
    try {
      await api.patch(`/api/spreadsheets/${id}`, { title });
      sheet.setDetail((d) => d && { ...d, title });
      toast.success("Nome atualizado.");
    } catch (e) {
      toast.error(e);
      setTitle(detail.title);
    }
  }

  async function addRow(afterId: string | null = null): Promise<SheetRecord | null> {
    try {
      const created = await sheet.addRows([{}], afterId ?? (detail?.records.length ? detail.records[detail.records.length - 1].id : null));
      return created[0] ?? null;
    } catch (e) {
      toast.error(e);
      return null;
    }
  }

  async function deleteRows(ids: string[]) {
    if (ids.length > 1 && !(await confirm({ title: `Excluir ${ids.length} linhas?`, text: "Você pode desfazer logo em seguida ou restaurar pelo histórico de versões.", confirm: "Excluir", danger: true }))) return;
    try {
      await sheet.deleteRows(ids);
      toast.success(ids.length === 1 ? "Linha excluída." : `${ids.length} linhas excluídas.`, { label: "Desfazer", run: () => void sheet.restoreRows(ids).catch(toast.error) });
    } catch (e) {
      toast.error(e);
    }
  }

  async function exportAs(format: "xlsx" | "pdf") {
    const filterBits: string[] = [];
    if (dq) filterBits.push(`busca “${dq}”`);
    for (const [colId, set] of filters) filterBits.push(`${columns.find((c) => c.id === colId)?.name}: ${[...set].slice(0, 3).join(", ")}${set.size > 3 ? "…" : ""}`);
    if (onlyPending) filterBits.push("somente pendentes");
    const isFiltered = filterBits.length > 0 || !!sort;
    try {
      await api.download(`/api/spreadsheets/${id}/export`, {
        format,
        clientId,
        recordIds: isFiltered ? rows.map((r) => r.id) : undefined,
        filterLabel: filterBits.join("; ") || null,
      });
    } catch (e) {
      toast.error(e);
    }
  }

  function copyLink() {
    const url = `${window.location.origin}/planilhas/${id}${clientId ? `?cliente=${clientId}` : ""}`;
    navigator.clipboard?.writeText(url).then(
      () => toast.success("Link copiado. Só quem tem acesso ao sistema consegue abrir."),
      () => toast.info(url),
    );
  }

  async function toggleFav() {
    if (!detail) return;
    sheet.setDetail((d) => d && { ...d, favorite: !d.favorite });
    await api.put(`/api/spreadsheets/${id}/favorite`, { on: !detail.favorite }).catch(toast.error);
  }

  async function resize(colId: string, width: number) {
    if (!detail) return;
    try {
      const r = await api.patch<{ schemaRev: number; column: Column }>(`/api/spreadsheets/${id}/columns/${colId}`, { width, schemaRev: detail.schemaRev });
      sheet.setDetail((d) => d && { ...d, schemaRev: r.schemaRev, columns: d.columns.map((c) => (c.id === colId ? { ...c, width } : c)) });
    } catch {
      /* largura é só preferência visual */
    }
  }

  async function removeColumn(col: Column) {
    if (!(await confirm({ title: `Excluir a coluna “${col.name}”?`, text: "Os valores ficam guardados no histórico de versões e podem ser restaurados.", confirm: "Excluir coluna", danger: true }))) return;
    try {
      await api.del(`/api/spreadsheets/${id}/columns/${col.id}?schemaRev=${detail?.schemaRev ?? ""}`);
      toast.success("Coluna excluída.");
      void sheet.reload();
    } catch (e) {
      toast.error(e);
    }
  }

  async function addColumnAfter(col: Column | null) {
    if (!detail) return;
    try {
      let n = 1;
      while (columns.some((c) => normalize(c.name) === normalize(`Nova coluna ${n}`))) n++;
      await api.post(`/api/spreadsheets/${id}/columns`, { name: `Nova coluna ${n}`, type: "text", afterId: col?.id ?? null, schemaRev: detail.schemaRev });
      await sheet.reload();
    } catch (e) {
      toast.error(e);
    }
  }

  async function removeSheet() {
    if (!(await confirm({ title: "Mover para a lixeira?", text: "A planilha pode ser recuperada por 30 dias.", confirm: "Mover para a lixeira", danger: true }))) return;
    try {
      await api.del(`/api/spreadsheets/${id}`);
      toast.success("Planilha movida para a lixeira.");
      navigate("/planilhas");
    } catch (e) {
      toast.error(e);
    }
  }

  async function duplicate() {
    try {
      const r = await api.post<{ id: string }>(`/api/spreadsheets/${id}/duplicate`, {});
      toast.success("Cópia criada.");
      navigate(`/planilhas/${r.id}`);
    } catch (e) {
      toast.error(e);
    }
  }

  if (sheet.error) return <div className="page"><ErrorState error={sheet.error} retry={sheet.reload} /></div>;
  if (!detail)
    return (
      <div className="page">
        <div className="skeleton" style={{ width: 280, height: 26, marginBottom: 18 }} />
        <div className="skeleton" style={{ width: "100%", height: 420 }} />
      </div>
    );

  const colMenuItems = (col: Column): MenuItem[] => [
    { label: "Ordenar A → Z / menor → maior", icon: <ArrowDownAZ />, onSelect: () => setSort({ colId: col.id, dir: "asc" }) },
    { label: "Ordenar Z → A / maior → menor", icon: <ArrowUpAZ />, onSelect: () => setSort({ colId: col.id, dir: "desc" }) },
    { label: "Filtrar valores…", icon: <Filter />, onSelect: () => setFilterDialog(col) },
    ...(canEdit && me?.scopeAll
      ? [
          { divider: true, label: "" },
          { label: "Configurar coluna…", icon: <Settings2 />, onSelect: () => setColDialog({ col }) },
          { label: "Inserir coluna à direita", icon: <Plus />, onSelect: () => void addColumnAfter(col) },
          { label: "Excluir coluna", icon: <Trash2 />, danger: true, onSelect: () => void removeColumn(col) },
        ]
      : []),
  ];

  const moreItems: MenuItem[] = [
    { label: "Histórico de alterações", icon: <History />, onSelect: () => setDrawer("history") },
    { label: "Versões salvas", icon: <RotateCcw />, onSelect: () => setDrawer("versions") },
    ...(canEdit
      ? [
          { divider: true, label: "" },
          { label: "Criar planilha do mês seguinte", icon: <FilePlus2 />, onSelect: () => setNextMonth(true) },
          { label: "Duplicar", icon: <Copy />, onSelect: () => void duplicate() },
          ...(me?.scopeAll ? [{ label: "Dados da planilha…", icon: <Pencil />, onSelect: () => setMetaOpen(true) }] : []),
          ...(me?.scopeAll ? [{ label: "Adicionar coluna", icon: <Columns3 />, onSelect: () => setColDialog({ col: null }) }] : []),
        ]
      : []),
    ...(detail.sourceFormat && me?.scopeAll ? [{ label: `Baixar arquivo original (${detail.sourceFormat.toUpperCase()})`, icon: <FileDown />, onSelect: () => void api.download(`/api/spreadsheets/${id}/source`).catch(toast.error) }] : []),
    ...(can("delete") && me?.scopeAll ? [{ divider: true, label: "" }, { label: "Mover para a lixeira", icon: <Trash2 />, danger: true, onSelect: () => void removeSheet() }] : []),
  ];

  const filteredClient = detail.filteredClientId;
  const clientLabel = detail.filteredClientName ?? "cliente";

  return (
    <div className="sheet-page">
      <div className="sheet-head">
        <Link to="/planilhas" className="btn ghost icon sm" aria-label="Voltar para planilhas">
          <ArrowLeft />
        </Link>
        <div style={{ minWidth: 0, flex: "1 1 260px" }}>
          <input
            className="sheet-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            readOnly={!canEdit || !me?.scopeAll}
            aria-label="Nome da planilha"
            size={Math.max(12, title.length + 1)}
          />
          <div className="row wrap" style={{ gap: 6, marginTop: 2 }}>
            <span className="badge">{detail.category}</span>
            <span className="badge brand">{periodLabel(detail.month, detail.year)}</span>
            {detail.clientName && <span className="badge success">{detail.clientName}</span>}
            {filteredClient && (
              <span className="filter-pill">
                Só as linhas de {clientLabel}
                <button onClick={() => setParams((p) => (p.delete("cliente"), p))} aria-label="Mostrar todas as linhas">
                  <X />
                </button>
              </span>
            )}
            {onlyPending && (
              <span className="filter-pill">
                Somente pendentes
                <button onClick={() => setParams((p) => (p.delete("status"), p))} aria-label="Remover filtro">
                  <X />
                </button>
              </span>
            )}
            <span className="muted small">
              {detail.records.length} linhas · atualizada {relTime(detail.updatedAt)}
              {detail.updatedByName ? ` por ${detail.updatedByName.split(" ")[0]}` : ""}
            </span>
          </div>
        </div>
        <SaveIndicator state={sheet.saveState} pending={sheet.pendingKeys.size} />
        <div className="row">
          <button className={`star ${detail.favorite ? "on" : ""}`} onClick={toggleFav} aria-label={detail.favorite ? "Remover dos favoritos" : "Favoritar"} title="Favorita">
            <Star />
          </button>
          <button className="btn sm" onClick={copyLink} title="Copiar link">
            <Link2 /> <span className="hide-mobile">Link</span>
          </button>
          <MenuButton
            className="btn sm"
            label="Exportar"
            align="end"
            items={[
              { label: "Excel (.xlsx)", icon: <Download />, onSelect: () => void exportAs("xlsx") },
              { label: "PDF para imprimir", icon: <Download />, onSelect: () => void exportAs("pdf") },
            ]}
          >
            <Download /> <span className="hide-mobile">Exportar</span>
          </MenuButton>
          <MenuButton className="btn sm icon" label="Mais ações" items={moreItems} align="end">
            <MoreHorizontal />
          </MenuButton>
        </div>
      </div>

      {detail.importNotes.length > 0 && notesOpen && (
        <div style={{ padding: "0 24px 10px" }}>
          <div className="banner">
            <Info />
            <div style={{ flex: 1 }}>
              <strong>Observações da importação</strong>
              <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                {detail.importNotes.slice(0, 6).map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </div>
            <button className="btn ghost icon sm" onClick={() => setNotesOpen(false)} aria-label="Fechar">
              <X />
            </button>
          </div>
        </div>
      )}

      <div className="sheet-tools">
        <div className="input-icon">
          <Search />
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisar nesta planilha…" aria-label="Pesquisar nesta planilha" />
        </div>
        {[...filters.entries()].map(([colId, set]) => {
          const col = columns.find((c) => c.id === colId);
          return (
            <span key={colId} className="filter-pill">
              {col?.name}: {[...set].slice(0, 2).join(", ") || "(nenhum)"}
              {set.size > 2 ? ` +${set.size - 2}` : ""}
              <button
                onClick={() =>
                  setFilters((f) => {
                    const n = new Map(f);
                    n.delete(colId);
                    return n;
                  })
                }
                aria-label="Remover filtro"
              >
                <X />
              </button>
            </span>
          );
        })}
        {sort && (
          <span className="filter-pill">
            Ordenado por {columns.find((c) => c.id === sort.colId)?.name} ({sort.dir === "asc" ? "crescente" : "decrescente"})
            <button onClick={() => setSort(null)} aria-label="Remover ordenação">
              <X />
            </button>
          </span>
        )}
        <span className="spacer" />
        {selStats && (
          <span className="muted small tabular hide-mobile">
            {selStats.cells} células · {selStats.count} números · soma {formatNumber(selStats.sum)}
          </span>
        )}
        {rows.length !== detail.records.length && <span className="muted small">{rows.length} de {detail.records.length} linhas</span>}
        {!isMobile && canEdit && (
          <button className="btn sm" onClick={() => void addRow()}>
            <Plus /> Linha
          </button>
        )}
      </div>

      {isMobile ? (
        <>
          <div className="sheet-summary">
            {[...totals.entries()]
              .sort(([a], [b]) => rank(columns.find((c) => c.id === a)) - rank(columns.find((c) => c.id === b)))
              .slice(0, 4)
              .map(([colId, v]) => (
              <div key={colId} className="card">
                <div className="muted small truncate">{columns.find((c) => c.id === colId)?.name}</div>
                <strong className="tabular">{v}</strong>
              </div>
            ))}
          </div>
          <MobileRows
            columns={columns}
            rows={rows}
            values={values}
            canEdit={canEdit}
            year={detail.year ?? undefined}
            onEdit={sheet.edit}
            onAdd={() => addRow()}
            onDelete={(rid) => void deleteRows([rid])}
            onError={(m) => toast.error(m)}
          />
        </>
      ) : (
        <div className="grid-wrap">
          <Grid
            columns={columns}
            rows={rows}
            values={values}
            canEdit={canEdit}
            year={detail.year ?? undefined}
            sort={sort}
            filtered={filtered}
            pendingKeys={sheet.pendingKeys}
            flash={sheet.flash}
            conflicts={sheet.conflicts}
            totals={totals}
            onEdit={sheet.edit}
            onAddRows={(r, after) => sheet.addRows(r, after).catch((e) => toast.error(e))}
            onDeleteRows={(ids) => void deleteRows(ids)}
            onSort={(colId) => setSort((s) => (s?.colId !== colId ? { colId, dir: "asc" } : s.dir === "asc" ? { colId, dir: "desc" } : null))}
            onColumnMenu={(col, anchor) => setColMenu({ col, anchor })}
            onResize={resize}
            onUndo={sheet.undo}
            onError={(m) => toast.error(m)}
            onFilterValue={(col, v) => setFilters((f) => new Map(f).set(col.id, new Set([formatCell(col, v)])))}
            onSelection={setSelStats}
          />
          {canEdit && (
            <div className="grid-add">
              <button className="btn ghost sm" onClick={() => void addRow()}>
                <Plus /> Adicionar linha
              </button>
              <span className="muted small hide-mobile">
                Dica: copie e cole direto do Excel · <span className="kbd">Ctrl</span>+<span className="kbd">Z</span> desfaz · <span className="kbd">Enter</span> edita
              </span>
            </div>
          )}
        </div>
      )}

      {colMenu && <Menu anchor={colMenu.anchor} items={colMenuItems(colMenu.col)} onClose={() => setColMenu(null)} />}
      {colDialog && (
        <ColumnDialog
          sheetId={id}
          column={colDialog.col}
          columns={columns}
          schemaRev={detail.schemaRev}
          isClientColumn={!!colDialog.col && detail.clientColumn === colDialog.col.id}
          onClose={() => setColDialog(null)}
          onSaved={(msg) => {
            setColDialog(null);
            if (msg) toast.info(msg);
            else toast.success("Coluna salva.");
            void sheet.reload();
          }}
        />
      )}
      {filterDialog && (
        <FilterDialog
          column={filterDialog}
          values={[...new Set((detail.records ?? []).map((r) => formatCell(filterDialog, values.get(r.id)?.[filterDialog.id] ?? null)))].sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }))}
          selected={filters.get(filterDialog.id) ?? null}
          onClose={() => setFilterDialog(null)}
          onApply={(s) =>
            setFilters((f) => {
              const n = new Map(f);
              if (s) n.set(filterDialog.id, s);
              else n.delete(filterDialog.id);
              return n;
            })
          }
        />
      )}
      {drawer === "versions" && <VersionsDrawer sheetId={id} canRestore={can("edit") && !!me?.scopeAll} onClose={() => setDrawer(null)} onRestored={() => void sheet.reload()} />}
      {drawer === "history" && <HistoryDrawer sheetId={id} onClose={() => setDrawer(null)} />}
      {nextMonth && <NewSheetDialog templateId={id} onClose={() => setNextMonth(false)} />}
      {metaOpen && <MetaDialog id={id} detail={detail} onClose={() => setMetaOpen(false)} onSaved={() => (setMetaOpen(false), void sheet.reload())} />}
    </div>
  );
}

function MetaDialog({ id, detail, onClose, onSaved }: { id: string; detail: { category: string; month: number | null; year: number | null; clientId: string | null }; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [category, setCategory] = useState(detail.category);
  const [month, setMonth] = useState(detail.month ? String(detail.month) : "");
  const [year, setYear] = useState(detail.year ? String(detail.year) : "");
  const [clientId, setClientId] = useState(detail.clientId ?? "");
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    api.get<{ clients: { id: string; name: string }[] }>("/api/clients").then((r) => setClients(r.clients)).catch(() => {});
  }, []);
  return (
    <Dialog
      title="Dados da planilha"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="btn primary"
            onClick={async () => {
              try {
                await api.patch(`/api/spreadsheets/${id}`, { category, month: month ? Number(month) : null, year: year ? Number(year) : null, clientId: clientId || null });
                toast.success("Dados atualizados.");
                onSaved();
              } catch (e) {
                toast.error(e);
              }
            }}
          >
            Salvar
          </button>
        </>
      }
    >
      <div className="stack">
        <label className="field">
          <span>Categoria</span>
          <input className="input" value={category} onChange={(e) => setCategory(e.target.value)} />
        </label>
        <div className="row" style={{ gap: 12 }}>
          <label className="field" style={{ flex: 1 }}>
            <span>Mês</span>
            <select className="select" value={month} onChange={(e) => setMonth(e.target.value)}>
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
            <input className="input" type="number" value={year} onChange={(e) => setYear(e.target.value)} />
          </label>
        </div>
        <label className="field">
          <span>Cliente da planilha</span>
          <select className="select" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">Planilha geral (vários clientes)</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
    </Dialog>
  );
}
