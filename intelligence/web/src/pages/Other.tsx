import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Copy, DatabaseBackup, History, KeyRound, LogOut, MessageSquare, Plus, ShieldCheck, Sparkles, Trash2, Users } from "lucide-react";
import type { AuditEvent, ClientSummary, Role } from "../../../shared/types.js";
import { ROLE_LABEL } from "../../../shared/types.js";
import { api, qs } from "../lib/api";
import { useLoad } from "../lib/hooks";
import { useSession } from "../lib/session";
import { dateTime, relTime } from "../lib/format";
import { Chat, NewChatButton } from "../components/Chat";
import { Dialog, Empty, ErrorState, SkeletonRows, useConfirm, useToast } from "../components/ui";
import { ActivityItem } from "./Dashboard";

// ------------------------------------------------------------------ assistente (página)

export function AssistantPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { assistant } = useSession();
  const { data, reload } = useLoad(() => api.get<{ conversations: { id: string; title: string; updatedAt: string }[] }>("/api/assistant/conversations"), []);
  const [key, setKey] = useState(0);
  const conversationId = id ?? null;

  return (
    <div style={{ paddingTop: 16 }}>
      <div className="assistant-page">
        <nav className="conv-list" aria-label="Conversas">
          <button
            onClick={() => {
              navigate("/assistente");
              setKey((k) => k + 1);
            }}
            style={{ fontWeight: 500, color: "var(--brand)" }}
          >
            <Plus style={{ width: 15 }} /> Nova conversa
          </button>
          <div className="nav-label" style={{ padding: "12px 10px 4px" }}>
            Recentes
          </div>
          {data?.conversations.map((c) => (
            <button key={c.id} className={c.id === conversationId ? "active" : ""} onClick={() => navigate(`/assistente/${c.id}`)} title={c.title}>
              <MessageSquare style={{ width: 14, flex: "none" }} />
              <span className="truncate" style={{ flex: 1 }}>
                {c.title}
              </span>
            </button>
          ))}
          {data && !data.conversations.length && <p className="muted small" style={{ padding: "4px 10px" }}>Suas conversas aparecem aqui.</p>}
        </nav>
        <Chat
          key={`${conversationId ?? "new"}-${key}`}
          conversationId={conversationId}
          onConversation={(cid) => {
            navigate(`/assistente/${cid}`, { replace: true });
            void reload();
          }}
          header={
            <div className="chat-head">
              <div className="ai-mark">
                <Sparkles />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3>Assistente Cuidare</h3>
                <span className="muted small">
                  {assistant?.mode === "rules" || !assistant?.model
                    ? "Motor próprio · custo zero · os dados não saem do servidor"
                    : `Motor próprio + modelo ${assistant.model}${assistant.local ? " (local)" : ""}`}
                </span>
              </div>
              <span className="only-mobile">
                <NewChatButton onClick={() => (navigate("/assistente"), setKey((k) => k + 1))} />
              </span>
            </div>
          }
        />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ histórico geral

export function ActivityPage() {
  const [source, setSource] = useState("");
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const load = async (before?: number) => {
    try {
      const r = await api.get<{ events: AuditEvent[] }>(`/api/audit${qs({ source, before })}`);
      setEvents((e) => (before ? [...(e ?? []), ...r.events] : r.events));
      setMore(r.events.length === 50);
      setError(null);
    } catch (e) {
      setError(e as Error);
    }
  };
  useEffect(() => {
    setEvents(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);
  const { me } = useSession();
  return (
    <div className="page">
      <div className="page-head">
        <div style={{ flex: 1 }}>
          <h1>Histórico</h1>
          <p className="sub">
            {me?.role === "admin" ? "Todas as alterações do sistema: quem fez, quando, de onde e o que mudou." : "As alterações feitas por você."} O histórico não pode ser apagado.
          </p>
        </div>
        <div className="segmented" role="group" aria-label="Origem">
          {[
            ["", "Tudo"],
            ["ui", "Tela"],
            ["ai", "Assistente"],
            ["import", "Importação"],
            ["system", "Sistema"],
          ].map(([v, l]) => (
            <button key={v} aria-pressed={source === v} onClick={() => setSource(v)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="card">
        {error ? (
          <ErrorState error={error} retry={() => load()} />
        ) : !events ? (
          <SkeletonRows n={8} />
        ) : !events.length ? (
          <Empty icon={<History />} title="Nada registrado ainda" />
        ) : (
          <div className="card-body">
            {events.map((e) => (
              <ActivityItem key={e.seq} e={e} />
            ))}
            {more && (
              <div style={{ padding: 14 }}>
                <button className="btn block" onClick={() => load(events[events.length - 1].seq)}>
                  Carregar mais
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ administração

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  scopeAll: boolean;
  active: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  clientIds: string[];
}

interface InviteRow {
  id: string;
  label: string;
  role: Role;
  scopeAll: boolean;
  hint: string;
  maxUses: number | null;
  uses: number;
  expiresAt: string | null;
  createdAt: string;
  status: string;
}

export function AdminPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const { me } = useSession();
  const users = useLoad(() => api.get<{ users: UserRow[] }>("/api/admin/users"), []);
  const invites = useLoad(() => api.get<{ invites: InviteRow[] }>("/api/admin/invites"), []);
  const backups = useLoad(() => api.get<{ backups: { name: string; size: number; createdAt: string }[]; every: number; keep: number }>("/api/admin/backups"), []);
  const clients = useLoad(() => api.get<{ clients: ClientSummary[] }>("/api/clients"), []);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [newCode, setNewCode] = useState<{ code: string; label: string } | null>(null);
  const [scopeUser, setScopeUser] = useState<UserRow | null>(null);

  async function patchUser(u: UserRow, body: Partial<UserRow>) {
    try {
      await api.patch(`/api/admin/users/${u.id}`, body);
      toast.success("Usuário atualizado.");
      void users.reload();
    } catch (e) {
      toast.error(e);
    }
  }

  async function revoke(inv: InviteRow) {
    if (!(await confirm({ title: `Revogar o código “${inv.label}”?`, text: "Ninguém mais conseguirá criar conta com ele. Quem já tem conta continua entrando normalmente.", confirm: "Revogar", danger: true }))) return;
    try {
      await api.del(`/api/admin/invites/${inv.id}`);
      void invites.reload();
    } catch (e) {
      toast.error(e);
    }
  }

  if (users.error) return <div className="page"><ErrorState error={users.error} /></div>;

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ flex: 1 }}>
          <h1>Administração</h1>
          <p className="sub">Pessoas, códigos de acesso e backups.</p>
        </div>
      </div>
      <div className="stack lg">
        <section className="card">
          <div className="card-head">
            <KeyRound style={{ width: 17, color: "var(--text-3)" }} />
            <h2 style={{ flex: 1 }}>Códigos de acesso</h2>
            <button className="btn primary sm" onClick={() => setInviteOpen(true)}>
              <Plus /> Novo código
            </button>
          </div>
          <p className="muted small" style={{ padding: "10px 18px 0" }}>
            O código é a porta de entrada: com ele a pessoa cria o próprio login (nome, e-mail e senha). Os códigos ficam guardados de forma criptografada e só aparecem uma vez, na criação.
          </p>
          {!invites.data ? (
            <SkeletonRows n={2} />
          ) : !invites.data.invites.length ? (
            <Empty icon={<KeyRound />} title="Nenhum código criado" />
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>Perfil</th>
                    <th className="hide-sm">Final</th>
                    <th className="hide-sm">Usos</th>
                    <th className="hide-sm">Validade</th>
                    <th>Situação</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {invites.data.invites.map((inv) => (
                    <tr key={inv.id}>
                      <td>{inv.label}</td>
                      <td>{ROLE_LABEL[inv.role]}</td>
                      <td className="hide-sm" style={{ fontFamily: "var(--mono)" }}>
                        {inv.hint}
                      </td>
                      <td className="hide-sm">
                        {inv.uses}
                        {inv.maxUses ? ` / ${inv.maxUses}` : ""}
                      </td>
                      <td className="hide-sm">{inv.expiresAt ? dateTime(inv.expiresAt) : "Sem validade"}</td>
                      <td>
                        <span className={`badge ${inv.status === "ativo" ? "success" : ""}`}>{inv.status}</span>
                      </td>
                      <td>
                        {inv.status === "ativo" && (
                          <button className="btn ghost sm danger" onClick={() => revoke(inv)}>
                            Revogar
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <Users style={{ width: 17, color: "var(--text-3)" }} />
            <h2 style={{ flex: 1 }}>Pessoas</h2>
          </div>
          {!users.data ? (
            <SkeletonRows n={3} />
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>Perfil</th>
                    <th className="hide-sm">Acesso a clientes</th>
                    <th className="hide-sm">Último acesso</th>
                    <th>Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {users.data.users.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <div className="item-title">{u.name}</div>
                        <div className="item-sub">{u.email}</div>
                      </td>
                      <td>
                        <select className="select" style={{ height: 32, width: "auto" }} value={u.role} disabled={u.id === me?.id} onChange={(e) => patchUser(u, { role: e.target.value as Role })} aria-label="Perfil">
                          {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABEL[r]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="hide-sm">
                        <button className="btn ghost sm" onClick={() => setScopeUser(u)} disabled={u.id === me?.id}>
                          {u.scopeAll ? "Todos os clientes" : `${u.clientIds.length} cliente(s)`}
                        </button>
                      </td>
                      <td className="hide-sm muted small">{u.lastLoginAt ? relTime(u.lastLoginAt) : "nunca"}</td>
                      <td>
                        {u.id === me?.id ? (
                          <span className="badge brand">você</span>
                        ) : (
                          <button className={`btn sm ${u.active ? "" : "primary"}`} onClick={() => patchUser(u, { active: !u.active })}>
                            {u.active ? "Desativar" : "Reativar"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted small" style={{ padding: "10px 18px 14px" }}>
            <strong>Administrador</strong>: tudo, inclusive pessoas e códigos. <strong>Editor</strong>: vê e altera planilhas e clientes. <strong>Leitura</strong>: só consulta e exporta; dados sensíveis (PIX, CPF…) ficam ocultos.
          </p>
        </section>

        <section className="card">
          <div className="card-head">
            <DatabaseBackup style={{ width: 17, color: "var(--text-3)" }} />
            <h2 style={{ flex: 1 }}>Backups</h2>
            <button
              className="btn sm"
              onClick={async () => {
                try {
                  const r = await api.post<{ name: string }>("/api/admin/backups");
                  toast.success(`Backup criado: ${r.name}`);
                  void backups.reload();
                } catch (e) {
                  toast.error(e);
                }
              }}
            >
              Fazer backup agora
            </button>
          </div>
          <p className="muted small" style={{ padding: "10px 18px 0" }}>
            {backups.data
              ? backups.data.every
                ? `Backup automático a cada ${backups.data.every} h; os ${backups.data.keep} mais recentes ficam guardados no servidor. Copie a pasta de dados para outro lugar com frequência.`
                : "Backup automático desligado."
              : ""}
          </p>
          <div className="card-body">
            {backups.data?.backups.slice(0, 8).map((b) => (
              <div key={b.name} className="list-item" style={{ cursor: "default" }}>
                <span style={{ flex: 1, fontFamily: "var(--mono)", fontSize: 12.5 }}>{b.name}</span>
                <span className="muted small">{(b.size / 1024 / 1024).toFixed(1)} MB</span>
                <span className="muted small">{relTime(b.createdAt)}</span>
              </div>
            ))}
            {backups.data && !backups.data.backups.length && <p className="muted small" style={{ padding: "6px 18px" }}>Nenhum backup ainda.</p>}
          </div>
        </section>
      </div>

      {inviteOpen && (
        <InviteDialog
          clients={clients.data?.clients ?? []}
          onClose={() => setInviteOpen(false)}
          onCreated={(code, label) => {
            setInviteOpen(false);
            setNewCode({ code, label });
            void invites.reload();
          }}
        />
      )}
      {newCode && (
        <Dialog
          title="Código criado"
          onClose={() => setNewCode(null)}
          icon={<ShieldCheck style={{ width: 20, color: "var(--success)" }} />}
          footer={
            <button className="btn primary" onClick={() => setNewCode(null)}>
              Pronto, já anotei
            </button>
          }
        >
          <div className="stack">
            <p className="muted">Envie este código para quem vai usar o sistema (“{newCode.label}”). Por segurança, ele não será mostrado de novo.</p>
            <div className="row">
              <input className="input lg code-input" readOnly value={newCode.code} onFocus={(e) => e.target.select()} aria-label="Código" />
              <button className="btn lg icon" onClick={() => navigator.clipboard?.writeText(newCode.code).then(() => toast.success("Código copiado."))} aria-label="Copiar código">
                <Copy />
              </button>
            </div>
            <p className="muted small">Link de acesso: {window.location.origin}/entrar</p>
          </div>
        </Dialog>
      )}
      {scopeUser && <ScopeDialog user={scopeUser} clients={clients.data?.clients ?? []} onClose={() => setScopeUser(null)} onSaved={() => (setScopeUser(null), void users.reload())} />}
    </div>
  );
}

function InviteDialog({ clients, onClose, onCreated }: { clients: ClientSummary[]; onClose: () => void; onCreated: (code: string, label: string) => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ label: "", role: "editor" as Role, maxUses: "1", days: "7", custom: "", scopeAll: true, clientIds: [] as string[] });
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.post<{ code: string }>("/api/admin/invites", {
        label: form.label,
        role: form.role,
        scopeAll: form.scopeAll,
        clientIds: form.scopeAll ? [] : form.clientIds,
        maxUses: form.maxUses ? Number(form.maxUses) : null,
        expiresInDays: form.days ? Number(form.days) : null,
        customCode: form.custom || null,
      });
      onCreated(r.code, form.label);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title="Novo código de acesso"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn primary" form="invite-form" disabled={busy || !form.label.trim()}>
            Criar código
          </button>
        </>
      }
    >
      <form id="invite-form" className="stack" onSubmit={submit}>
        <label className="field">
          <span>Para quem é (nome do convite)</span>
          <input className="input" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Ex.: Pai, Escritório, Coordenação" maxLength={80} required />
        </label>
        <label className="field">
          <span>Perfil</span>
          <select className="select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
            {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
        <div className="row" style={{ gap: 12 }}>
          <label className="field" style={{ flex: 1 }}>
            <span>Quantas pessoas podem usar</span>
            <input className="input" type="number" min={1} max={1000} value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: e.target.value })} placeholder="Sem limite" />
          </label>
          <label className="field" style={{ flex: 1 }}>
            <span>Válido por (dias)</span>
            <input className="input" type="number" min={1} max={365} value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })} placeholder="Sem validade" />
          </label>
        </div>
        <label className="field">
          <span>Código fixo personalizado (opcional)</span>
          <input className="input" value={form.custom} onChange={(e) => setForm({ ...form, custom: e.target.value.toUpperCase() })} placeholder="Deixe vazio para gerar um código seguro" maxLength={40} />
          <span className="hint">Mínimo 8 letras/números. Códigos gerados automaticamente são mais seguros.</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={form.scopeAll} onChange={(e) => setForm({ ...form, scopeAll: e.target.checked })} />
          Acesso a todos os clientes
        </label>
        {!form.scopeAll && (
          <div className="stack" style={{ gap: 6, maxHeight: 200, overflow: "auto", padding: 8, border: "1px solid var(--border)", borderRadius: 8 }}>
            {clients.map((c) => (
              <label key={c.id} className="check">
                <input
                  type="checkbox"
                  checked={form.clientIds.includes(c.id)}
                  onChange={() => setForm((f) => ({ ...f, clientIds: f.clientIds.includes(c.id) ? f.clientIds.filter((x) => x !== c.id) : [...f.clientIds, c.id] }))}
                />
                {c.name}
              </label>
            ))}
          </div>
        )}
      </form>
    </Dialog>
  );
}

function ScopeDialog({ user, clients, onClose, onSaved }: { user: UserRow; clients: ClientSummary[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [scopeAll, setScopeAll] = useState(user.scopeAll);
  const [ids, setIds] = useState<string[]>(user.clientIds);
  return (
    <Dialog
      title={`Acesso de ${user.name}`}
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
                await api.patch(`/api/admin/users/${user.id}`, { scopeAll, clientIds: ids });
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
        <label className="check">
          <input type="checkbox" checked={scopeAll} onChange={(e) => setScopeAll(e.target.checked)} /> Acesso a todos os clientes
        </label>
        {!scopeAll && (
          <>
            <p className="muted small">A pessoa só verá as linhas e planilhas destes clientes:</p>
            <div className="stack" style={{ gap: 6, maxHeight: 300, overflow: "auto" }}>
              {clients.map((c) => (
                <label key={c.id} className="check">
                  <input type="checkbox" checked={ids.includes(c.id)} onChange={() => setIds((x) => (x.includes(c.id) ? x.filter((y) => y !== c.id) : [...x, c.id]))} />
                  {c.name}
                </label>
              ))}
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ conta

export function AccountPage() {
  const { me, logout } = useSession();
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/api/auth/password", { current, next });
      toast.success("Senha alterada. As outras sessões abertas foram encerradas.");
      setCurrent("");
      setNext("");
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page" style={{ maxWidth: 640 }}>
      <div className="page-head">
        <div style={{ flex: 1 }}>
          <h1>Minha conta</h1>
          <p className="sub">
            {me?.name} · {me?.email} · {me ? ROLE_LABEL[me.role] : ""}
          </p>
        </div>
        <button className="btn" onClick={() => void logout()}>
          <LogOut /> Sair
        </button>
      </div>
      <form className="card card-pad stack" onSubmit={submit}>
        <h2>Trocar senha</h2>
        <label className="field">
          <span>Senha atual</span>
          <input className="input" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
        </label>
        <label className="field">
          <span>Nova senha</span>
          <input className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={10} required />
          <span className="hint">Pelo menos 10 caracteres.</span>
        </label>
        <div>
          <button className="btn primary" disabled={busy}>
            Salvar nova senha
          </button>
        </div>
      </form>
    </div>
  );
}

export function NotFoundPage() {
  return (
    <div className="page">
      <Empty icon={<Trash2 />} title="Página não encontrada" text="O endereço pode estar errado ou o item foi removido.">
        <Link to="/" className="btn">
          Voltar ao início
        </Link>
      </Empty>
    </div>
  );
}
