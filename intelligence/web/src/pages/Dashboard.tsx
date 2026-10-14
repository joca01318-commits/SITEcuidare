import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertCircle,
  ArrowRight,
  Bot,
  Download,
  FilePlus2,
  FileSpreadsheet,
  FileUp,
  History,
  Rows3,
  Sparkles,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import type { AuditEvent, ClientSummary, SpreadsheetSummary } from "../../../shared/types.js";
import { formatMoney } from "../../../shared/text.js";
import { api, qs } from "../lib/api";
import { useLoad } from "../lib/hooks";
import { useAssistant, useSession } from "../lib/session";
import { firstName, greeting, initials, periodLabel, relTime } from "../lib/format";
import { Empty, ErrorState, SkeletonRows } from "../components/ui";
import { ClientDialog, ImportDialog, NewSheetDialog } from "../components/Dialogs";

interface DashboardData {
  user: { name: string };
  counts: { clients: number; spreadsheets: number; records: number };
  recentSheets: SpreadsheetSummary[];
  recentClients: ClientSummary[];
  activity: AuditEvent[];
  payments: { period: string; total: number; rows: number; sheets: { id: string; title: string; total: number; rows: number; column: string }[] } | null;
  pending: { spreadsheetId: string; title: string; period: string; count: number; amount: number | null; values: string[] }[];
}

export function DashboardPage() {
  const { me, can } = useSession();
  const { show } = useAssistant();
  const navigate = useNavigate();
  const { data, error, loading, reload } = useLoad(() => api.get<DashboardData>("/api/dashboard"), []);
  const [ask, setAsk] = useState("");
  const [dialog, setDialog] = useState<"import" | "sheet" | "client" | null>(null);

  if (error) return <div className="page"><ErrorState error={error} retry={reload} /></div>;

  const pendingTotal = data?.pending.reduce((n, p) => n + p.count, 0) ?? 0;
  const pendingAmount = data?.pending.reduce((n, p) => n + (p.amount ?? 0), 0) ?? 0;

  return (
    <div className="page">
      <div className="greet">
        <div>
          <h1>
            {greeting()}, {firstName(me?.name ?? "")}
          </h1>
          <p className="muted" style={{ marginTop: 4 }}>
            {new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}
          </p>
        </div>
        {can("edit") && (
          <div className="row wrap">
            <button className="btn" onClick={() => setDialog("client")}>
              <UserPlus /> Cadastrar cliente
            </button>
            <button className="btn" onClick={() => setDialog("import")}>
              <FileUp /> Importar planilha
            </button>
            <button className="btn primary" onClick={() => setDialog("sheet")}>
              <FilePlus2 /> Nova planilha
            </button>
          </div>
        )}
      </div>

      <form
        className="ask-box"
        onSubmit={(e) => {
          e.preventDefault();
          if (ask.trim()) {
            show(ask.trim());
            setAsk("");
          }
        }}
      >
        <Sparkles />
        <input value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="Peça à assistente… ex.: quanto o seu Dinaldo pagou este ano?" aria-label="Pergunta para a assistente" />
        <button className="btn primary" disabled={!ask.trim()}>
          Perguntar
        </button>
      </form>

      <div className="stats">
        <Stat icon={<Users />} label="Clientes" value={data?.counts.clients} foot="cadastrados" to="/clientes" />
        <Stat icon={<FileSpreadsheet />} label="Planilhas" value={data?.counts.spreadsheets} foot="armazenadas" to="/planilhas" />
        <Stat icon={<Rows3 />} label="Linhas" value={data?.counts.records} foot="em todas as planilhas" />
        {data && !data.payments ? (
          <div className="card stat">
            <div className="label">
              <Wallet /> Pagamentos
            </div>
            <div className="foot" style={{ marginTop: 10 }}>
              Aparece quando houver planilhas com mês e uma coluna marcada como “valor pago”.
            </div>
          </div>
        ) : (
          <Stat
            icon={<Wallet />}
            label={`Pagos · ${data?.payments?.period ?? ""}`}
            value={data?.payments ? formatMoney(data.payments.total) : undefined}
            foot={data?.payments ? `${data.payments.rows} lançamentos` : ""}
          />
        )}
      </div>

      {data && data.pending.length > 0 && (
        <div className="card" style={{ marginBottom: 16, borderColor: "#f3d9a8" }}>
          <div className="card-head" style={{ background: "var(--warning-bg)", borderBottomColor: "#f3d9a8", borderRadius: "10px 10px 0 0" }}>
            <AlertCircle style={{ width: 17, color: "var(--warning)" }} />
            <h2 style={{ flex: 1 }}>
              {pendingTotal} pagamento(s) pendente(s){pendingAmount ? ` · ${formatMoney(pendingAmount)}` : ""}
            </h2>
            <button className="btn sm" onClick={() => show("Mostre os pagamentos pendentes")}>
              <Bot /> Ver detalhes
            </button>
          </div>
          <div className="card-body">
            {data.pending.map((p) => (
              <Link key={p.spreadsheetId} className="list-item" to={`/planilhas/${p.spreadsheetId}${qs({ status: "pendente" })}`}>
                <span className="file-icon" style={{ background: "var(--warning-bg)", color: "var(--warning)" }}>
                  <FileSpreadsheet />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="item-title truncate" style={{ display: "block" }}>
                    {p.title}
                  </span>
                  <span className="item-sub">{p.period || "Sem período"}</span>
                </span>
                <span className="badge warning">{p.count} pendente(s)</span>
                {p.amount !== null && <span className="tabular hide-mobile">{formatMoney(p.amount)}</span>}
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="grid-2">
        <div className="stack lg">
          <section className="card">
            <div className="card-head">
              <h2 style={{ flex: 1 }}>Abertas recentemente</h2>
              <Link to="/planilhas" className="small">
                Ver todas <ArrowRight style={{ width: 13, verticalAlign: -2 }} />
              </Link>
            </div>
            <div className="card-body">
              {loading && !data ? (
                <SkeletonRows n={4} />
              ) : !data?.recentSheets.length ? (
                <Empty icon={<FileSpreadsheet />} title="Nenhuma planilha aberta ainda" text="Importe suas planilhas do Excel para começar.">
                  {can("import") && (
                    <button className="btn primary" onClick={() => setDialog("import")}>
                      <FileUp /> Importar planilha
                    </button>
                  )}
                </Empty>
              ) : (
                data.recentSheets.map((s) => (
                  <Link key={s.id} to={`/planilhas/${s.id}`} className="list-item">
                    <span className="file-icon">
                      <FileSpreadsheet />
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="item-title truncate" style={{ display: "block" }}>
                        {s.title}
                      </span>
                      <span className="item-sub">
                        {periodLabel(s.month, s.year)} · {s.rowCount} linhas
                      </span>
                    </span>
                    <span className="muted small hide-mobile">{relTime(s.updatedAt)}</span>
                  </Link>
                ))
              )}
            </div>
          </section>

          {data?.payments && data.payments.sheets.length > 0 && (
            <section className="card">
              <div className="card-head">
                <Wallet style={{ width: 17, color: "var(--success)" }} />
                <h2 style={{ flex: 1 }}>Pagamentos registrados · {data.payments.period}</h2>
              </div>
              <div className="card-body">
                {data.payments.sheets.map((p) => (
                  <Link key={p.id} to={`/planilhas/${p.id}`} className="list-item">
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="item-title truncate" style={{ display: "block" }}>
                        {p.title}
                      </span>
                      <span className="item-sub">
                        {p.rows} lançamentos pagos · coluna “{p.column}”
                      </span>
                    </span>
                    <strong className="tabular">{formatMoney(p.total)}</strong>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="stack lg">
          <section className="card">
            <div className="card-head">
              <h2 style={{ flex: 1 }}>Clientes acessados</h2>
              <Link to="/clientes" className="small">
                Todos
              </Link>
            </div>
            <div className="card-body">
              {loading && !data ? (
                <SkeletonRows n={3} />
              ) : !data?.recentClients.length ? (
                <p className="muted small" style={{ padding: "10px 18px" }}>
                  Os clientes que você abrir aparecem aqui.
                </p>
              ) : (
                data.recentClients.map((c) => (
                  <button key={c.id} className="list-item" onClick={() => navigate(`/clientes/${c.id}`)}>
                    <span className="file-icon client">{initials(c.name)}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="item-title truncate" style={{ display: "block" }}>
                        {c.name}
                      </span>
                      <span className="item-sub">{c.spreadsheetCount} planilha(s)</span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <History style={{ width: 17, color: "var(--text-3)" }} />
              <h2 style={{ flex: 1 }}>Atividade recente</h2>
              <Link to="/atividade" className="small">
                Histórico
              </Link>
            </div>
            <div className="card-body">
              {loading && !data ? (
                <SkeletonRows n={3} />
              ) : !data?.activity.length ? (
                <p className="muted small" style={{ padding: "10px 18px" }}>
                  Nenhuma atividade ainda.
                </p>
              ) : (
                data.activity.map((e) => <ActivityItem key={e.seq} e={e} />)
              )}
            </div>
          </section>
        </div>
      </div>

      {dialog === "import" && <ImportDialog onClose={() => setDialog(null)} />}
      {dialog === "sheet" && <NewSheetDialog onClose={() => setDialog(null)} />}
      {dialog === "client" && (
        <ClientDialog
          onClose={() => setDialog(null)}
          onSaved={(c) => {
            setDialog(null);
            navigate(`/clientes/${c.id}`);
          }}
        />
      )}
    </div>
  );
}

function Stat({ icon, label, value, foot, to }: { icon: React.ReactNode; label: string; value?: number | string; foot?: string; to?: string }) {
  const body = (
    <>
      <div className="label">
        {icon} {label}
      </div>
      <div className="value">{value === undefined ? <span className="skeleton" style={{ display: "inline-block", width: 60, height: 24 }} /> : typeof value === "number" ? value.toLocaleString("pt-BR") : value}</div>
      {foot && <div className="foot">{foot}</div>}
    </>
  );
  return to ? (
    <Link to={to} className="card stat" style={{ color: "inherit", textDecoration: "none" }}>
      {body}
    </Link>
  ) : (
    <div className="card stat">{body}</div>
  );
}

export function ActivityItem({ e }: { e: AuditEvent }) {
  const icon = e.source === "ai" ? <Sparkles /> : e.source === "import" ? <Download /> : <History />;
  return (
    <div className="activity">
      <span className={`dot ${e.source}`}>{icon}</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13 }}>{e.summary}</div>
        <div className="muted small">
          {e.userName ?? "Sistema"} · {relTime(e.at)}
          {e.source === "ai" ? " · pela assistente" : ""}
        </div>
      </div>
      {e.spreadsheetId && (
        <Link to={`/planilhas/${e.spreadsheetId}`} className="btn ghost sm icon" aria-label="Abrir planilha">
          <ArrowRight />
        </Link>
      )}
    </div>
  );
}
