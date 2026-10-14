import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, History, KeyRound, LockKeyhole, ShieldCheck, Sparkles } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useSession } from "../lib/session";

function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <aside className="auth-side">
        <div className="row" style={{ gap: 10 }}>
          <span className="brand-mark" style={{ background: "rgba(255,255,255,.12)" }}>
            <Sparkles />
          </span>
          <span style={{ color: "#fff", fontWeight: 600 }}>Cuidare Intelligence</span>
        </div>
        <div>
          <h2>Todas as planilhas da Cuidare em um só lugar, com uma assistente que trabalha por você.</h2>
          <ul>
            <li>
              <Sparkles /> Peça em português: “abra a planilha de outubro do seu Dinaldo”.
            </li>
            <li>
              <ShieldCheck /> Toda alteração é confirmada por você e fica registrada.
            </li>
            <li>
              <History /> Versões guardadas automaticamente: nada se perde.
            </li>
          </ul>
        </div>
        <p style={{ fontSize: 12, opacity: 0.7 }}>Uso interno · dados protegidos conforme a LGPD</p>
      </aside>
      <main className="auth-main">
        <div className="auth-box">{children}</div>
      </main>
    </div>
  );
}

/** Etapa 1: código de acesso. */
export function GatePage() {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ label: string }>("/api/auth/gate", { code });
      setOk(r.label);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (ok) return <RegisterStep label={ok} onBack={() => setOk(null)} />;

  return (
    <AuthShell>
      <div className="stack lg">
        <div className="brand-mark" style={{ width: 44, height: 44, borderRadius: 12 }}>
          <KeyRound />
        </div>
        <div>
          <h1>Código de acesso</h1>
          <p className="muted">Digite o código que você recebeu da Cuidare para entrar pela primeira vez.</p>
        </div>
        <form className="stack" onSubmit={submit}>
          <input
            className="input lg code-input"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="XXXX-XXXX-XXXX"
            autoComplete="one-time-code"
            autoCapitalize="characters"
            spellCheck={false}
            aria-label="Código de acesso"
            maxLength={40}
            autoFocus
          />
          {error && <p className="error-text">{error}</p>}
          <button className="btn primary lg block" disabled={busy || code.replace(/[^A-Z0-9]/gi, "").length < 6}>
            {busy ? "Verificando…" : "Continuar"} <ArrowRight />
          </button>
        </form>
        <p className="muted small" style={{ textAlign: "center" }}>
          Já tem conta? <Link to="/login">Entrar com e-mail e senha</Link>
        </p>
      </div>
    </AuthShell>
  );
}

/** Etapa 2: criação da conta individual. */
function RegisterStep({ label, onBack }: { label: string; onBack: () => void }) {
  const { refresh } = useSession();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (form.password !== form.confirm) return setError("As senhas não conferem.");
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/auth/register", { name: form.name, email: form.email, password: form.password });
      await refresh();
      navigate("/", { replace: true });
    } catch (err) {
      setError((err as Error).message);
      if (err instanceof ApiError && err.code === "invalid_code") setTimeout(onBack, 1500);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <div className="stack lg">
        <button className="btn ghost sm" style={{ alignSelf: "flex-start", marginLeft: -10 }} onClick={onBack}>
          <ArrowLeft /> Voltar
        </button>
        <div>
          <span className="badge success" style={{ marginBottom: 10 }}>
            Código válido · {label}
          </span>
          <h1>Crie seu acesso</h1>
          <p className="muted">Cada pessoa tem o seu login. Assim fica registrado quem fez cada alteração.</p>
        </div>
        <form className="stack" onSubmit={submit}>
          <label className="field">
            <span>Nome</span>
            <input className="input" value={form.name} onChange={set("name")} autoComplete="name" required maxLength={120} />
          </label>
          <label className="field">
            <span>E-mail</span>
            <input className="input" type="email" value={form.email} onChange={set("email")} autoComplete="email" required maxLength={254} />
          </label>
          <label className="field">
            <span>Senha</span>
            <input className="input" type="password" value={form.password} onChange={set("password")} autoComplete="new-password" required minLength={10} />
            <span className="hint">Pelo menos 10 caracteres. Uma frase curta funciona bem.</span>
          </label>
          <label className="field">
            <span>Confirme a senha</span>
            <input className="input" type="password" value={form.confirm} onChange={set("confirm")} autoComplete="new-password" required />
          </label>
          {error && <p className="error-text">{error}</p>}
          <button className="btn primary lg block" disabled={busy}>
            {busy ? "Criando…" : "Criar acesso e entrar"}
          </button>
        </form>
      </div>
    </AuthShell>
  );
}

export function LoginPage() {
  const { refresh } = useSession();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/auth/login", { email, password });
      await refresh();
      const back = sessionStorage.getItem("ci_after_login");
      sessionStorage.removeItem("ci_after_login");
      navigate(back && back.startsWith("/") ? back : "/", { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <div className="stack lg">
        <div className="brand-mark" style={{ width: 44, height: 44, borderRadius: 12 }}>
          <LockKeyhole />
        </div>
        <div>
          <h1>Entrar</h1>
          <p className="muted">Use o e-mail e a senha que você cadastrou.</p>
        </div>
        <form className="stack" onSubmit={submit}>
          <label className="field">
            <span>E-mail</span>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required autoFocus />
          </label>
          <label className="field">
            <span>Senha</span>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </label>
          {error && <p className="error-text">{error}</p>}
          <button className="btn primary lg block" disabled={busy}>
            {busy ? "Entrando…" : "Entrar"}
          </button>
        </form>
        <p className="muted small" style={{ textAlign: "center" }}>
          Primeiro acesso? <Link to="/entrar">Usar código de acesso</Link>
        </p>
      </div>
    </AuthShell>
  );
}
