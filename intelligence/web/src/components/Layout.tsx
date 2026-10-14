import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Activity,
  FileSpreadsheet,
  Home,
  LogOut,
  Menu as MenuIcon,
  Search,
  Settings,
  Shield,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { api } from "../lib/api";
import { useAssistant, useSession } from "../lib/session";
import { useDebounced, useIsMobile } from "../lib/hooks";
import { initials } from "../lib/format";
import { Chat, NewChatButton } from "./Chat";
import { Menu } from "./ui";
import { ROLE_LABEL } from "../../../shared/types.js";

function Brand() {
  return (
    <Link to="/" className="brand" style={{ textDecoration: "none", color: "inherit" }}>
      <span className="brand-mark" aria-hidden>
        <Sparkles />
      </span>
      <span className="brand-name">
        Cuidare
        <small>Intelligence</small>
      </span>
    </Link>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { me, logout, can } = useSession();
  const { open, show } = useAssistant();
  const isMobile = useIsMobile();
  const [scrolled, setScrolled] = useState(false);
  const [moreAnchor, setMoreAnchor] = useState<HTMLElement | null>(null);
  const loc = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 4);
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  useEffect(() => window.scrollTo(0, 0), [loc.pathname]);

  const onAssistantPage = loc.pathname.startsWith("/assistente");

  return (
    <div className="app">
      <aside className="sidebar">
        <Brand />
        <nav className="nav" aria-label="Principal">
          <NavLink to="/" end>
            <Home /> Início
          </NavLink>
          <NavLink to="/planilhas">
            <FileSpreadsheet /> Planilhas
          </NavLink>
          <NavLink to="/clientes">
            <Users /> Clientes
          </NavLink>
          <NavLink to="/assistente">
            <Sparkles /> Assistente
          </NavLink>
          <div className="nav-label">Controle</div>
          <NavLink to="/atividade">
            <Activity /> Histórico
          </NavLink>
          {can("admin") && (
            <NavLink to="/admin">
              <Shield /> Administração
            </NavLink>
          )}
        </nav>
        <div className="sidebar-foot">
          <Link to="/conta" className="user-chip">
            <span className="avatar">{initials(me?.name ?? "")}</span>
            <span style={{ minWidth: 0, flex: 1 }}>
              <span className="truncate" style={{ display: "block", fontWeight: 500, fontSize: 13 }}>
                {me?.name}
              </span>
              <span className="muted small">{me ? ROLE_LABEL[me.role] : ""}</span>
            </span>
            <Settings style={{ width: 15, color: "var(--text-3)" }} />
          </Link>
        </div>
      </aside>

      <div className="main">
        <header className={`topbar ${scrolled ? "scrolled" : ""}`}>
          {isMobile && (
            <Link to="/" className="brand-mark" aria-label="Início">
              <Sparkles />
            </Link>
          )}
          <GlobalSearch />
          {!isMobile && !onAssistantPage && (
            <button className="btn" onClick={() => show()}>
              <Sparkles style={{ color: "var(--accent)" }} /> Perguntar à assistente
            </button>
          )}
        </header>
        <main id="conteudo">{children}</main>
      </div>

      {!open && !onAssistantPage && (
        <button className="fab" onClick={() => show()} aria-label="Abrir assistente">
          <Sparkles />
          <span>Assistente</span>
        </button>
      )}
      {open && !onAssistantPage && <AssistantPanel />}

      <nav className="bottom-nav" aria-label="Navegação">
        <NavLink to="/" end>
          <Home />
          Início
        </NavLink>
        <NavLink to="/planilhas">
          <FileSpreadsheet />
          Planilhas
        </NavLink>
        <NavLink to="/assistente">
          <Sparkles />
          Assistente
        </NavLink>
        <NavLink to="/clientes">
          <Users />
          Clientes
        </NavLink>
        <button onClick={(e) => setMoreAnchor(moreAnchor ? null : e.currentTarget)} aria-haspopup="menu">
          <MenuIcon />
          Mais
        </button>
      </nav>
      {moreAnchor && (
        <Menu
          anchor={moreAnchor}
          align="end"
          onClose={() => setMoreAnchor(null)}
          items={[
            { label: "Histórico", icon: <Activity />, onSelect: () => navigate("/atividade") },
            ...(can("admin") ? [{ label: "Administração", icon: <Shield />, onSelect: () => navigate("/admin") }] : []),
            { label: "Minha conta", icon: <Settings />, onSelect: () => navigate("/conta") },
            { divider: true, label: "" },
            { label: "Sair", icon: <LogOut />, onSelect: () => void logout() },
          ]}
        />
      )}
    </div>
  );
}

function AssistantPanel() {
  const { hide, draft } = useAssistant();
  const [conversationId, setConversationId] = useState<string | null>(() => sessionStorage.getItem("ci_conv"));
  const [key, setKey] = useState(0);
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === "Escape" && hide();
    document.addEventListener("keydown", on);
    return () => document.removeEventListener("keydown", on);
  }, [hide]);
  return (
    <section className="assistant-panel" aria-label="Assistente">
      <Chat
        key={key}
        compact
        conversationId={conversationId}
        initialText={draft}
        onConversation={(id) => {
          setConversationId(id);
          try {
            sessionStorage.setItem("ci_conv", id);
          } catch {
            /* sem armazenamento */
          }
        }}
        onNavigate={() => window.innerWidth <= 900 && hide()}
        header={
          <div className="chat-head">
            <div className="ai-mark">
              <Sparkles />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h3>Assistente Cuidare</h3>
              <span className="muted small">Encontra, calcula e altera planilhas</span>
            </div>
            <NewChatButton
              onClick={() => {
                setConversationId(null);
                try {
                  sessionStorage.removeItem("ci_conv");
                } catch {
                  /* ok */
                }
                setKey((k) => k + 1);
              }}
            />
            <button className="btn ghost icon sm" onClick={hide} aria-label="Fechar assistente">
              <X />
            </button>
          </div>
        }
      />
    </section>
  );
}

interface Hit {
  kind: "client" | "spreadsheet";
  id: string;
  title: string;
  subtitle: string;
}

function GlobalSearch() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const dq = useDebounced(q, 180);
  const navigate = useNavigate();
  const { show } = useAssistant();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (dq.trim().length < 2) {
      setHits([]);
      return;
    }
    let alive = true;
    api
      .get<{ hits: Hit[] }>(`/api/search?q=${encodeURIComponent(dq)}`)
      .then((r) => alive && (setHits(r.hits), setActive(0)))
      .catch(() => alive && setHits([]));
    return () => {
      alive = false;
    };
  }, [dq]);

  useEffect(() => {
    const on = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ref.current?.querySelector("input")?.focus();
      }
    };
    document.addEventListener("mousedown", on);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", on);
      document.removeEventListener("keydown", key);
    };
  }, []);

  const items: (Hit | { kind: "ask"; id: string; title: string; subtitle: string })[] = [
    ...hits,
    ...(q.trim().length >= 3 ? [{ kind: "ask" as const, id: "ask", title: `Perguntar à assistente: “${q.trim()}”`, subtitle: "" }] : []),
  ];

  function go(i: number) {
    const it = items[i];
    if (!it) return;
    setOpen(false);
    setQ("");
    if (it.kind === "client") navigate(`/clientes/${it.id}`);
    else if (it.kind === "spreadsheet") navigate(`/planilhas/${it.id}`);
    else show(q.trim());
  }

  return (
    <div className="search" ref={ref}>
      <div className="input-icon">
        <Search />
        <input
          className="input"
          placeholder="Buscar cliente ou planilha…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(items.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              go(active);
            } else if (e.key === "Escape") setOpen(false);
          }}
          aria-label="Busca global"
          role="combobox"
          aria-expanded={open && items.length > 0}
        />
      </div>
      {open && q.trim().length >= 2 && (
        <div className="search-results" role="listbox">
          {!hits.length && <div className="muted small" style={{ padding: "8px 10px" }}>Nada encontrado com “{q}”.</div>}
          {items.map((h, i) => (
            <button key={h.kind + h.id} className="search-item" role="option" aria-selected={i === active} onMouseEnter={() => setActive(i)} onClick={() => go(i)}>
              {h.kind === "client" ? <Users /> : h.kind === "spreadsheet" ? <FileSpreadsheet /> : <Sparkles style={{ color: "var(--accent)" }} />}
              <span style={{ minWidth: 0 }}>
                <span className="truncate" style={{ display: "block" }}>
                  {h.title}
                </span>
                {h.subtitle && <span className="muted small truncate" style={{ display: "block" }}>{h.subtitle}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
