import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUp, Check, Download, ExternalLink, MessageSquarePlus, RotateCcw, Sparkles, User, X } from "lucide-react";
import type { AssistantAction, AssistantMessage } from "../../../shared/types.js";
import { api, qs } from "../lib/api";
import { useAssistant, useSession } from "../lib/session";
import { RichText, useToast } from "./ui";

interface Props {
  conversationId: string | null;
  onConversation: (id: string) => void;
  initialText?: string | null;
  compact?: boolean;
  onNavigate?: () => void;
  header?: React.ReactNode;
}

export function Chat({ conversationId, onConversation, initialText, compact, onNavigate, header }: Props) {
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sentInitial = useRef<string | null>(null);
  const { assistant } = useSession();
  const { page, notifyChanged } = useAssistant();
  const navigate = useNavigate();
  const toast = useToast();
  const convRef = useRef(conversationId);
  convRef.current = conversationId;

  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      return;
    }
    if (messages.length && messages[0] && convRef.current === conversationId && loadedFor.current === conversationId) return;
    setLoading(true);
    api
      .get<{ messages: AssistantMessage[] }>(`/api/assistant/conversations/${conversationId}`)
      .then((r) => {
        loadedFor.current = conversationId;
        setMessages(r.messages);
      })
      .catch(() => setMessages([]))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const send = useCallback(
    async (raw: string) => {
      const t = raw.trim();
      if (!t || busy) return;
      setText("");
      const temp: AssistantMessage = { id: `tmp-${Date.now()}`, role: "user", content: t, createdAt: new Date().toISOString() };
      setMessages((m) => [...m, temp]);
      setBusy(true);
      try {
        const r = await api.post<{ conversationId: string; messages: AssistantMessage[] }>("/api/assistant/messages", {
          conversationId: convRef.current,
          text: t,
          page: { spreadsheetId: page.spreadsheetId ?? null, clientId: page.clientId ?? null },
        });
        loadedFor.current = r.conversationId;
        if (r.conversationId !== convRef.current) onConversation(r.conversationId);
        setMessages((m) => [...m.filter((x) => x.id !== temp.id), ...r.messages]);
        if (r.messages.some((x) => x.content.startsWith("✅") || x.content.startsWith("↩️"))) notifyChanged();
      } catch (e) {
        setMessages((m) => m.filter((x) => x.id !== temp.id));
        setText(t);
        toast.error(e);
      } finally {
        setBusy(false);
        inputRef.current?.focus();
      }
    },
    [busy, page, onConversation, notifyChanged, toast],
  );

  useEffect(() => {
    if (initialText && sentInitial.current !== initialText) {
      sentInitial.current = initialText;
      void send(initialText);
    }
  }, [initialText, send]);

  async function act(a: AssistantAction) {
    switch (a.kind) {
      case "open_spreadsheet":
        navigate(`/planilhas/${a.spreadsheetId}${qs({ cliente: a.clientId ?? undefined })}`);
        onNavigate?.();
        return;
      case "open_client":
        navigate(`/clientes/${a.clientId}`);
        onNavigate?.();
        return;
      case "download":
        try {
          await api.download(a.url);
        } catch (e) {
          toast.error(e);
        }
        return;
      case "suggest":
        void send(a.text.replace(/^\d+\.\s+/, (m) => m));
        return;
      case "confirm":
      case "cancel":
      case "undo": {
        setBusy(true);
        try {
          const r = await api.post<{ messages: AssistantMessage[] }>(`/api/assistant/actions/${a.pendingId}/${a.kind}`);
          setMessages((m) => [
            ...m.map((x) =>
              x.pending?.id === a.pendingId && a.kind !== "undo"
                ? {
                    ...x,
                    pending: { ...x.pending, status: a.kind === "confirm" ? (r.messages[0]?.content.startsWith("❌") ? "failed" : "done") : "cancelled" },
                    actions: x.actions?.filter((y) => !("pendingId" in y) || y.pendingId !== a.pendingId),
                  }
                : x.actions?.some((y) => y.kind === "undo" && y.pendingId === a.pendingId) && a.kind === "undo"
                  ? { ...x, actions: x.actions.filter((y) => !(y.kind === "undo" && y.pendingId === a.pendingId)) }
                  : x,
            ),
            ...r.messages,
          ]);
          if (a.kind !== "cancel") notifyChanged();
        } catch (e) {
          toast.error(e);
        } finally {
          setBusy(false);
        }
      }
    }
  }

  const suggestions = assistant?.suggestions ?? [];

  return (
    <div className="chat">
      {header}
      <div className="chat-log" ref={logRef} aria-live="polite">
        {loading && <div className="muted small">Carregando conversa…</div>}
        {!loading && !messages.length && (
          <div className="stack" style={{ margin: "auto 0", gap: 16 }}>
            <div className="row" style={{ gap: 12 }}>
              <div className="ai-mark" style={{ width: 38, height: 38 }}>
                <Sparkles />
              </div>
              <div>
                <h2>Como posso ajudar?</h2>
                <p className="muted small">Peça em português, do jeito que você falaria. Toda alteração passa pela sua confirmação.</p>
              </div>
            </div>
            <div className="chips">
              {suggestions.map((s) => (
                <button key={s} className="chip" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <Message key={m.id} m={m} onAction={act} busy={busy} />
        ))}
        {busy && (
          <div className="typing" aria-label="A assistente está trabalhando">
            <i />
            <i />
            <i />
          </div>
        )}
      </div>
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <textarea
          ref={inputRef}
          value={text}
          rows={1}
          placeholder={compact ? "Pergunte ou peça uma alteração…" : "Ex.: abra a planilha de outubro do seu Dinaldo"}
          onChange={(e) => {
            setText(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(140, e.target.scrollHeight)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(text);
            }
          }}
          aria-label="Mensagem para a assistente"
          maxLength={1000}
          autoFocus
        />
        <button className="btn primary icon" style={{ "--h": "42px", borderRadius: 12 } as React.CSSProperties} disabled={!text.trim() || busy} aria-label="Enviar">
          <ArrowUp />
        </button>
      </form>
    </div>
  );
}

function Message({ m, onAction, busy }: { m: AssistantMessage; onAction: (a: AssistantAction) => void; busy: boolean }) {
  const isUser = m.role === "user";
  const actions = (m.actions ?? []).filter((a) => a.kind !== "confirm" && a.kind !== "cancel");
  const confirm = m.actions?.find((a) => a.kind === "confirm");
  const cancel = m.actions?.find((a) => a.kind === "cancel");
  return (
    <div className={`msg ${isUser ? "user" : "assistant"}`}>
      {m.content && (
        <div className="bubble">
          <RichText text={m.content} />
        </div>
      )}
      {m.table && (
        <div className="msg-table">
          <table>
            <thead>
              <tr>
                {m.table.columns.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {m.table.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((v, j) => (
                    <td key={j} style={{ textAlign: typeof v === "number" || /^R\$/.test(String(v)) ? "right" : "left" }}>
                      {v ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {m.table.footer && (
              <tfoot>
                <tr>
                  {m.table.footer.map((v, j) => (
                    <td key={j} style={{ textAlign: typeof v === "number" || /^R\$/.test(String(v)) ? "right" : "left" }}>
                      {v ?? ""}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
      {m.pending && (
        <div className="pending-card">
          <div className="pc-head">
            <Sparkles style={{ width: 14, height: 14, color: "var(--accent)" }} />
            <span style={{ flex: 1 }}>{m.pending.summary}</span>
            {m.pending.status === "done" && <span className="badge success">Feito</span>}
            {m.pending.status === "cancelled" && <span className="badge">Cancelado</span>}
            {m.pending.status === "failed" && <span className="badge danger">Falhou</span>}
            {m.pending.status === "expired" && <span className="badge">Expirou</span>}
          </div>
          {m.pending.changes?.length ? (
            <dl>
              {m.pending.changes.map((c, i) => (
                <div key={i} style={{ display: "contents" }}>
                  <dt>{c.label}</dt>
                  <dd>{c.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {m.pending.status === "pending" && confirm && (
            <div className="row" style={{ padding: "8px 12px 12px" }}>
              <button className="btn primary sm" disabled={busy} onClick={() => onAction(confirm)}>
                <Check /> Confirmar
              </button>
              {cancel && (
                <button className="btn sm" disabled={busy} onClick={() => onAction(cancel)}>
                  <X /> Cancelar
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {!!actions.length && (
        <div className="msg-actions">
          {actions.map((a, i) =>
            a.kind === "suggest" ? (
              <button key={i} className="chip" onClick={() => onAction(a)} disabled={busy}>
                {a.text}
              </button>
            ) : (
              <button key={i} className={`btn sm ${a.kind === "open_spreadsheet" || a.kind === "open_client" ? "" : ""}`} onClick={() => onAction(a)} disabled={busy && a.kind === "undo"}>
                {a.kind === "download" ? <Download /> : a.kind === "undo" ? <RotateCcw /> : a.kind === "open_client" ? <User /> : <ExternalLink />}
                {"label" in a ? a.label : ""}
              </button>
            ),
          )}
        </div>
      )}
      {!isUser && m.engine && m.engine !== "rules" && m.engine !== "system" && <span className="meta">via {m.engine}</span>}
    </div>
  );
}

export function NewChatButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="btn ghost sm" onClick={onClick} title="Nova conversa">
      <MessageSquarePlus /> Nova
    </button>
  );
}
