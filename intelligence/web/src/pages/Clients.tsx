import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AlertCircle, ArrowLeft, Archive, FilePlus2, FileSpreadsheet, Pencil, Search, Sparkles, UserPlus, Users, Wallet } from "lucide-react";
import type { AuditEvent, ClientSummary, SpreadsheetSummary } from "../../../shared/types.js";
import { formatMoney } from "../../../shared/text.js";
import { api, qs } from "../lib/api";
import { useDebounced, useLoad } from "../lib/hooks";
import { useAssistant, useSession } from "../lib/session";
import { initials, periodLabel, relTime } from "../lib/format";
import { Empty, ErrorState, SkeletonRows, useConfirm, useToast } from "../components/ui";
import { ClientDialog, NewSheetDialog } from "../components/Dialogs";
import { ActivityItem } from "./Dashboard";
import { useEffect } from "react";

export function ClientsPage() {
  const [q, setQ] = useState("");
  const dq = useDebounced(q, 150);
  const navigate = useNavigate();
  const { can } = useSession();
  const [creating, setCreating] = useState(false);
  const { data, error, loading, reload } = useLoad(() => api.get<{ clients: ClientSummary[] }>(`/api/clients${qs({ q: dq })}`), [dq]);

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ flex: 1 }}>
          <h1>Clientes</h1>
          <p className="sub">Cada cliente reúne todas as planilhas em que aparece.</p>
        </div>
        {can("edit") && (
          <button className="btn primary" onClick={() => setCreating(true)}>
            <UserPlus /> Novo cliente
          </button>
        )}
      </div>
      <div className="toolbar">
        <div className="input-icon">
          <Search />
          <input className="input" placeholder="Buscar pelo nome (aceita apelidos e erros de digitação)…" value={q} onChange={(e) => setQ(e.target.value)} style={{ height: 36 }} aria-label="Buscar clientes" />
        </div>
      </div>
      {error ? (
        <ErrorState error={error} retry={reload} />
      ) : loading && !data ? (
        <div className="card">
          <SkeletonRows n={6} />
        </div>
      ) : !data?.clients.length ? (
        <div className="card">
          {dq ? (
            <Empty icon={<Search />} title={`Nenhum cliente encontrado para “${dq}”`} />
          ) : (
            <Empty icon={<Users />} title="Nenhum cliente cadastrado" text="Os clientes são criados automaticamente ao importar uma planilha com a coluna “Assistido” ou “Cliente”, ou manualmente aqui." />
          )}
        </div>
      ) : (
        <div className="card" style={{ overflow: "hidden" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Cliente</th>
                <th className="num">Planilhas</th>
                <th className="hide-sm">Última atividade</th>
              </tr>
            </thead>
            <tbody>
              {data.clients.map((c) => (
                <tr key={c.id} className="clickable" onClick={() => navigate(`/clientes/${c.id}`)}>
                  <td>
                    <div className="row" style={{ gap: 10 }}>
                      <span className="file-icon client">{initials(c.name)}</span>
                      <div style={{ minWidth: 0 }}>
                        <Link to={`/clientes/${c.id}`} className="item-title" style={{ color: "inherit" }} onClick={(e) => e.stopPropagation()}>
                          {c.name}
                        </Link>
                        {c.aliases.length > 0 && <div className="item-sub truncate">também: {c.aliases.join(", ")}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="num">{c.spreadsheetCount}</td>
                  <td className="hide-sm muted small">{relTime(c.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating && (
        <ClientDialog
          onClose={() => setCreating(false)}
          onSaved={(c) => {
            setCreating(false);
            navigate(`/clientes/${c.id}`);
          }}
        />
      )}
    </div>
  );
}

interface ClientDetail {
  client: ClientSummary;
  sheets: SpreadsheetSummary[];
  pending: { spreadsheetId: string; title: string; period: string; count: number; amount: number | null }[];
  totals: { year: number; total: number; count: number; columns: string[] };
  activity: AuditEvent[];
}

export function ClientPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const { can } = useSession();
  const assistant = useAssistant();
  const [editing, setEditing] = useState(false);
  const [newSheet, setNewSheet] = useState(false);
  const { data, error, loading, reload, setData } = useLoad(() => api.get<ClientDetail>(`/api/clients/${id}`), [id]);

  useEffect(() => {
    assistant.setPage({ clientId: id });
    return () => assistant.setPage({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (error) return <div className="page"><ErrorState error={error} retry={reload} /></div>;
  if (loading || !data)
    return (
      <div className="page">
        <div className="skeleton" style={{ width: 240, height: 26, marginBottom: 18 }} />
        <div className="card">
          <SkeletonRows n={5} />
        </div>
      </div>
    );

  const c = data.client;
  // Planilhas em ordem cronológica, agrupadas por ano.
  const byYear = new Map<string, SpreadsheetSummary[]>();
  for (const s of data.sheets) {
    const k = s.year ? String(s.year) : "Sem ano";
    byYear.set(k, [...(byYear.get(k) ?? []), s]);
  }

  async function archive() {
    if (!(await confirm({ title: `Arquivar ${c.name}?`, text: "O cliente some das listas e buscas, mas as planilhas e o histórico continuam guardados.", confirm: "Arquivar" }))) return;
    try {
      await api.patch(`/api/clients/${id}`, { archived: true });
      toast.success("Cliente arquivado.");
      navigate("/clientes");
    } catch (e) {
      toast.error(e);
    }
  }

  return (
    <div className="page">
      <Link to="/clientes" className="btn ghost sm" style={{ marginLeft: -10, marginBottom: 8 }}>
        <ArrowLeft /> Clientes
      </Link>
      <div className="page-head">
        <span className="file-icon client" style={{ width: 52, height: 52, fontSize: 18 }}>
          {initials(c.name)}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1>{c.name}</h1>
          <p className="sub">
            {c.aliases.length ? `Também conhecido como ${c.aliases.join(", ")} · ` : ""}
            {c.spreadsheetCount} planilha(s)
          </p>
        </div>
        <div className="row wrap">
          <button className="btn" onClick={() => assistant.show(`Quanto o cliente ${c.name} pagou este ano?`)}>
            <Sparkles style={{ color: "var(--accent)" }} /> Perguntar sobre {c.name.split(" ")[0]}
          </button>
          {can("edit") && (
            <>
              <button className="btn" onClick={() => setEditing(true)}>
                <Pencil /> Editar
              </button>
              <button className="btn" onClick={() => setNewSheet(true)}>
                <FilePlus2 /> Nova planilha
              </button>
              <button className="btn ghost icon" onClick={archive} aria-label="Arquivar cliente" title="Arquivar">
                <Archive />
              </button>
            </>
          )}
        </div>
      </div>

      <div className="stats" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
        <div className="card stat">
          <div className="label">
            <FileSpreadsheet /> Planilhas
          </div>
          <div className="value">{c.spreadsheetCount}</div>
        </div>
        <div className="card stat">
          <div className="label">
            <Wallet /> Lançamentos em {data.totals.year}
          </div>
          <div className="value">{data.totals.count ? formatMoney(data.totals.total) : "—"}</div>
          <div className="foot">{data.totals.count ? `${data.totals.count} lançamentos · coluna ${data.totals.columns.map((x) => `“${x}”`).join(", ")}` : "Sem colunas de valor configuradas neste ano"}</div>
        </div>
        <div className="card stat">
          <div className="label">
            <AlertCircle /> Pendentes
          </div>
          <div className="value">{data.pending.reduce((n, p) => n + p.count, 0)}</div>
          <div className="foot">{data.pending.length ? formatMoney(data.pending.reduce((n, p) => n + (p.amount ?? 0), 0)) : "Nenhum pagamento pendente"}</div>
        </div>
      </div>

      {c.notes && (
        <div className="banner" style={{ marginBottom: 16 }}>
          {c.notes}
        </div>
      )}

      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <h2 style={{ flex: 1 }}>Planilhas</h2>
          </div>
          {!data.sheets.length ? (
            <Empty icon={<FileSpreadsheet />} title="Nenhuma planilha deste cliente" />
          ) : (
            [...byYear.entries()].map(([year, list]) => (
              <div key={year}>
                <div className="nav-label" style={{ padding: "12px 18px 4px" }}>
                  {year}
                </div>
                {list.map((s) => (
                  <Link key={s.id} to={`/planilhas/${s.id}${qs({ cliente: s.clientId === id ? undefined : id })}`} className="list-item">
                    <span className="file-icon">
                      <FileSpreadsheet />
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="item-title truncate" style={{ display: "block" }}>
                        {s.title}
                      </span>
                      <span className="item-sub">
                        {periodLabel(s.month, s.year)} · {s.rowCount} linha(s) deste cliente
                      </span>
                    </span>
                    {data.pending.find((p) => p.spreadsheetId === s.id) && <span className="badge warning">pendente</span>}
                  </Link>
                ))}
              </div>
            ))
          )}
        </section>
        <section className="card">
          <div className="card-head">
            <h2 style={{ flex: 1 }}>Atividade</h2>
          </div>
          <div className="card-body">
            {!data.activity.length ? <p className="muted small" style={{ padding: "10px 18px" }}>Nenhuma alteração registrada.</p> : data.activity.map((e) => <ActivityItem key={e.seq} e={e} />)}
          </div>
        </section>
      </div>

      {editing && (
        <ClientDialog
          client={c}
          onClose={() => setEditing(false)}
          onSaved={(nc) => {
            setEditing(false);
            setData((d) => d && { ...d, client: nc });
            toast.success("Cliente atualizado.");
          }}
        />
      )}
      {newSheet && <NewSheetDialog onClose={() => setNewSheet(false)} defaultClientId={id} />}
    </div>
  );
}
