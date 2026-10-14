import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";

// ------------------------------------------------------------------ avisos (toasts)

type ToastKind = "success" | "error" | "info";
interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
  action?: { label: string; run: () => void };
}

const ToastCtx = createContext<(kind: ToastKind, text: string, action?: Toast["action"]) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: ToastKind, text: string, action?: Toast["action"]) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, kind, text, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), action ? 8000 : kind === "error" ? 6500 : 3800);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.kind === "success" ? <CheckCircle2 /> : t.kind === "error" ? <XCircle /> : <Info />}
            <span style={{ flex: 1 }}>{t.text}</span>
            {t.action && (
              <button
                onClick={() => {
                  t.action!.run();
                  setToasts((x) => x.filter((y) => y.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const push = useContext(ToastCtx);
  return {
    success: (t: string, action?: Toast["action"]) => push("success", t, action),
    error: (t: string | unknown) => push("error", typeof t === "string" ? t : t instanceof Error ? t.message : "Algo deu errado."),
    info: (t: string, action?: Toast["action"]) => push("info", t, action),
  };
}

// ------------------------------------------------------------------ diálogos

export function Dialog({
  title,
  onClose,
  children,
  footer,
  wide,
  icon,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  icon?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const on = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", on);
    const first = ref.current?.querySelector<HTMLElement>("input, select, textarea, button:not(.dialog-x)");
    first?.focus();
    return () => {
      document.removeEventListener("keydown", on);
      prev?.focus?.();
    };
  }, [onClose]);
  return createPortal(
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" ref={ref}>
        <div className="dialog-head">
          {icon}
          <h2 style={{ flex: 1 }}>{title}</h2>
          <button className="btn ghost icon sm dialog-x" onClick={onClose} aria-label="Fechar">
            <X />
          </button>
        </div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

interface ConfirmOpts {
  title: string;
  text?: ReactNode;
  confirm?: string;
  danger?: boolean;
}

const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const ask = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setState({ ...o, resolve })), []);
  const close = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      {state && (
        <Dialog
          title={state.title}
          onClose={() => close(false)}
          icon={state.danger ? <AlertTriangle style={{ color: "var(--danger)", width: 20 }} /> : undefined}
          footer={
            <>
              <button className="btn" onClick={() => close(false)}>
                Cancelar
              </button>
              <button className={`btn ${state.danger ? "danger solid" : "primary"}`} onClick={() => close(true)}>
                {state.confirm ?? "Confirmar"}
              </button>
            </>
          }
        >
          <div className="muted" style={{ fontSize: 14 }}>
            {state.text}
          </div>
        </Dialog>
      )}
    </ConfirmCtx.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmCtx);

// ------------------------------------------------------------------ menu suspenso

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect?: () => void;
  danger?: boolean;
  disabled?: boolean;
  divider?: boolean;
  heading?: boolean;
}

export function Menu({ anchor, items, onClose, align = "start" }: { anchor: HTMLElement; items: MenuItem[]; onClose: () => void; align?: "start" | "end" }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: -9999, left: -9999 });
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const el = ref.current!;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = align === "end" ? r.right - w : r.left;
    let top = r.bottom + 6;
    if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
    if (left < 8) left = 8;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    setPos({ top, left });
  }, [anchor, align]);
  useEffect(() => {
    const on = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const scroll = () => onClose();
    document.addEventListener("mousedown", on);
    document.addEventListener("keydown", key);
    window.addEventListener("resize", scroll);
    return () => {
      document.removeEventListener("mousedown", on);
      document.removeEventListener("keydown", key);
      window.removeEventListener("resize", scroll);
    };
  }, [anchor, onClose]);
  return createPortal(
    <div className="menu" ref={ref} style={pos} role="menu">
      {items.map((it, i) =>
        it.divider ? (
          <hr key={i} />
        ) : it.heading ? (
          <div key={i} className="menu-label">
            {it.label}
          </div>
        ) : (
          <button
            key={i}
            role="menuitem"
            className={it.danger ? "danger" : ""}
            disabled={it.disabled}
            onClick={() => {
              onClose();
              it.onSelect?.();
            }}
          >
            {it.icon}
            <span className="truncate">{it.label}</span>
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}

/** Botão que abre um menu. */
export function MenuButton({ items, children, className = "btn", label, align }: { items: MenuItem[]; children: ReactNode; className?: string; label?: string; align?: "start" | "end" }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <button
        type="button"
        className={className}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        onClick={(e) => {
          e.stopPropagation();
          setAnchor(anchor ? null : e.currentTarget);
        }}
      >
        {children}
      </button>
      {anchor && <Menu anchor={anchor} items={items} onClose={() => setAnchor(null)} align={align} />}
    </>
  );
}

// ------------------------------------------------------------------ estados

export function Empty({ icon, title, text, children }: { icon: ReactNode; title: string; text?: ReactNode; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="icon">{icon}</div>
      <h3>{title}</h3>
      {text && <p style={{ maxWidth: 380 }}>{text}</p>}
      {children}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: Error; retry?: () => void }) {
  const status = (error as { status?: number }).status;
  return (
    <Empty
      icon={<AlertTriangle />}
      title={status === 404 ? "Não encontrado" : status === 403 ? "Sem permissão" : "Não foi possível carregar"}
      text={error.message}
    >
      {retry && status !== 404 && status !== 403 && (
        <button className="btn" onClick={retry}>
          Tentar de novo
        </button>
      )}
    </Empty>
  );
}

export function SkeletonRows({ n = 5 }: { n?: number }) {
  return (
    <div style={{ padding: "8px 18px" }}>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="row" style={{ padding: "10px 0" }}>
          <div className="skeleton" style={{ width: 34, height: 34, borderRadius: 9 }} />
          <div style={{ flex: 1 }}>
            <div className="skeleton" style={{ width: `${55 + ((i * 17) % 30)}%`, height: 12 }} />
            <div className="skeleton" style={{ width: "30%", height: 10, marginTop: 8 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="row muted small">
      <span className="spinner" aria-hidden />
      {label}
    </span>
  );
}

/** Renderiza **negrito** e quebras de linha das mensagens da assistente (sem HTML). */
export function RichText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong> : <span key={i}>{p}</span>))}
    </>
  );
}
