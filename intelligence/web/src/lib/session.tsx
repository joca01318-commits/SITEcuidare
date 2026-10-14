import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Role } from "../../../shared/types.js";
import { api, setUnauthorizedHandler } from "./api";

export interface Me {
  id: string;
  name: string;
  email: string;
  role: Role;
  scopeAll: boolean;
}

export interface AssistantInfo {
  mode: "rules" | "hybrid" | "llm";
  model: string | null;
  local: boolean;
  suggestions: string[];
}

interface SessionCtx {
  me: Me | null;
  assistant: AssistantInfo | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  can: (perm: "edit" | "admin" | "import" | "delete") => boolean;
}

const Ctx = createContext<SessionCtx>(null as never);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [assistant, setAssistant] = useState<AssistantInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const r = await api.get<{ user: Me; assistant: AssistantInfo }>("/api/auth/me");
      setMe(r.user);
      setAssistant(r.assistant);
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    setUnauthorizedHandler(() => setMe(null));
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await api.post("/api/auth/logout");
    } finally {
      setMe(null);
      window.location.assign("/entrar");
    }
  }, []);

  const can = useCallback(
    (perm: "edit" | "admin" | "import" | "delete") => {
      if (!me) return false;
      if (perm === "admin") return me.role === "admin";
      return me.role === "admin" || me.role === "editor";
    },
    [me],
  );

  return <Ctx.Provider value={{ me, assistant, loading, refresh, logout, can }}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);

// ------------------------------------------------------------------ assistente (painel flutuante)

export interface PageContext {
  spreadsheetId?: string | null;
  clientId?: string | null;
}

interface AssistantCtx {
  open: boolean;
  draft: string | null;
  page: PageContext;
  show: (text?: string) => void;
  hide: () => void;
  setPage: (p: PageContext) => void;
  /** A planilha aberta é avisada quando a assistente altera dados. */
  changed: number;
  notifyChanged: () => void;
}

const ACtx = createContext<AssistantCtx>(null as never);

export function AssistantProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [page, setPage] = useState<PageContext>({});
  const [changed, setChanged] = useState(0);
  const show = useCallback((text?: string) => {
    setDraft(text ?? null);
    setOpen(true);
  }, []);
  const hide = useCallback(() => setOpen(false), []);
  const notifyChanged = useCallback(() => setChanged((n) => n + 1), []);
  return <ACtx.Provider value={{ open, draft, page, show, hide, setPage, changed, notifyChanged }}>{children}</ACtx.Provider>;
}

export const useAssistant = () => useContext(ACtx);
