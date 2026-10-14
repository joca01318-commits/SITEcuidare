import type { Actor, Core } from "../core.js";
import type { AssistantAction, AssistantMessage } from "../../shared/types.js";
import { json } from "../db/db.js";
import { AppError, badRequest, newId, notFound, nowIso } from "../lib/util.js";
import { canSeeClient } from "../domain/access.js";
import { respond as rulesRespond, SUGGESTIONS, type ConvState, type PageContext, type Reply } from "./rules.js";
import { llmConfigured, respondWithLlm } from "./llm.js";
import { cancelPending, executePending, undoPending, type ToolCtx } from "./tools.js";

interface ConvRow {
  id: string;
  user_id: string;
  title: string;
  state: string;
  created_at: string;
  updated_at: string;
}

interface MsgRow {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  payload: string | null;
  created_at: string;
}

function toMessage(r: MsgRow): AssistantMessage {
  const payload = json<Partial<AssistantMessage>>(r.payload, {});
  return { id: r.id, role: r.role, content: r.content, createdAt: r.created_at, ...payload };
}

export function assistantInfo(core: Core) {
  const llm = llmConfigured(core.cfg);
  const mode = llm ? core.cfg.ai.mode : "rules";
  return {
    mode,
    model: llm && mode !== "rules" ? core.cfg.ai.model : null,
    local: core.cfg.ai.providerIsLocal,
    suggestions: SUGGESTIONS,
  };
}

export function listConversations(core: Core, actor: Actor) {
  return core.db
    .all<ConvRow>("SELECT * FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50", [actor.id])
    .map((c) => ({ id: c.id, title: c.title, updatedAt: c.updated_at }));
}

function loadConversation(core: Core, actor: Actor, id: string): ConvRow {
  const c = core.db.get<ConvRow>("SELECT * FROM conversations WHERE id = ? AND user_id = ?", [id, actor.id]);
  if (!c) throw notFound("Conversa");
  return c;
}

export function getConversation(core: Core, actor: Actor, id: string) {
  const c = loadConversation(core, actor, id);
  const messages = core.db.all<MsgRow>("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at, rowid", [id]).map(toMessage);
  return { id: c.id, title: c.title, messages };
}

export function deleteConversation(core: Core, actor: Actor, id: string) {
  loadConversation(core, actor, id);
  core.db.run("DELETE FROM conversations WHERE id = ?", [id]);
}

function addMessage(core: Core, conversationId: string, role: "user" | "assistant", content: string, payload?: Partial<AssistantMessage>): AssistantMessage {
  const id = newId("msg");
  const now = nowIso();
  core.db.run("INSERT INTO messages (id, conversation_id, role, content, payload, created_at) VALUES (?,?,?,?,?,?)", [
    id,
    conversationId,
    role,
    content,
    payload ? JSON.stringify(payload) : null,
    now,
  ]);
  core.db.run("UPDATE conversations SET updated_at = ? WHERE id = ?", [now, conversationId]);
  return { id, role, content, createdAt: now, ...payload };
}

function sanitizePage(core: Core, actor: Actor, page: PageContext | undefined): PageContext {
  const out: PageContext = {};
  if (page?.spreadsheetId && core.db.get("SELECT 1 FROM spreadsheets WHERE id = ? AND org_id = ? AND deleted_at IS NULL", [page.spreadsheetId, actor.orgId]))
    out.spreadsheetId = page.spreadsheetId;
  if (page?.clientId && canSeeClient(actor, page.clientId) && core.db.get("SELECT 1 FROM clients WHERE id = ? AND org_id = ?", [page.clientId, actor.orgId]))
    out.clientId = page.clientId;
  return out;
}

export async function sendMessage(core: Core, actor: Actor, input: { conversationId?: string | null; text: string; page?: PageContext }) {
  const text = input.text.replace(/\s+/g, " ").trim();
  if (!text) throw badRequest("Escreva uma mensagem.");
  if (text.length > 1000) throw badRequest("Mensagem longa demais (máx. 1000 caracteres).");
  let conv: ConvRow;
  if (input.conversationId) conv = loadConversation(core, actor, input.conversationId);
  else {
    const id = newId("cnv");
    const now = nowIso();
    core.db.run("INSERT INTO conversations (id, user_id, title, state, created_at, updated_at) VALUES (?,?,?, '{}', ?, ?)", [id, actor.id, text.slice(0, 70), now, now]);
    conv = loadConversation(core, actor, id);
  }
  const userMsg = addMessage(core, conv.id, "user", text);
  const state = json<ConvState>(conv.state, {});
  const page = sanitizePage(core, actor, input.page);
  const ctx: ToolCtx = { core, actor, conversationId: conv.id, external: false };

  let reply: Reply;
  let engine = "rules";
  const cfg = core.cfg;
  const llm = llmConfigured(cfg) && cfg.ai.mode !== "rules";
  try {
    if (llm && cfg.ai.mode === "llm") {
      reply = await viaLlm(core, actor, conv.id, text, state, page);
      engine = cfg.ai.model;
    } else {
      reply = rulesRespond(ctx, text, state, page);
      if (!reply.handled && llm) {
        reply = await viaLlm(core, actor, conv.id, text, state, page);
        engine = cfg.ai.model;
      }
    }
  } catch (e) {
    // Modelo externo indisponível: o motor próprio assume.
    reply = rulesRespond(ctx, text, state, page);
    if (e instanceof AppError) reply.content = `(${e.message} Usei o motor interno.)\n${reply.content}`;
    engine = "rules";
  }

  // "sim" / "não" respondendo a uma confirmação pendente.
  if (reply.content === "__confirm__" && state.pendingId) {
    const msgs = await confirmAction(core, actor, state.pendingId);
    return { conversationId: conv.id, messages: [userMsg, ...msgs] };
  }
  if (reply.content === "__cancel__" && state.pendingId) {
    const msgs = cancelAction(core, actor, state.pendingId);
    return { conversationId: conv.id, messages: [userMsg, ...msgs] };
  }

  core.db.run("UPDATE conversations SET state = ? WHERE id = ?", [JSON.stringify(reply.state), conv.id]);
  const assistantMsg = addMessage(core, conv.id, "assistant", reply.content, {
    actions: reply.actions,
    table: reply.table,
    pending: reply.pending,
    engine,
  });
  return { conversationId: conv.id, messages: [userMsg, assistantMsg] };
}

async function viaLlm(core: Core, actor: Actor, conversationId: string, text: string, state: ConvState, page: PageContext): Promise<Reply> {
  const history = core.db
    .all<MsgRow>("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 11", [conversationId])
    .reverse()
    .slice(0, -1)
    .map((m) => ({ role: m.role, content: m.content }));
  const ctx: ToolCtx = { core, actor, conversationId, external: !core.cfg.ai.providerIsLocal };
  return respondWithLlm(ctx, core.cfg, text, history, state, page);
}

function setPendingStatus(core: Core, pendingId: string, status: string) {
  const rows = core.db.all<MsgRow>("SELECT * FROM messages WHERE payload LIKE ?", [`%${pendingId}%`]);
  for (const r of rows) {
    const p = json<Partial<AssistantMessage>>(r.payload, {});
    if (p.pending?.id === pendingId) {
      p.pending.status = status;
      p.actions = (p.actions ?? []).filter((a) => !("pendingId" in a && a.pendingId === pendingId && (a.kind === "confirm" || a.kind === "cancel")));
      core.db.run("UPDATE messages SET payload = ? WHERE id = ?", [JSON.stringify(p), r.id]);
    }
  }
}

function conversationOf(core: Core, actor: Actor, pendingId: string): string {
  const p = core.db.get<{ conversation_id: string | null; user_id: string }>("SELECT conversation_id, user_id FROM pending_actions WHERE id = ?", [pendingId]);
  if (!p || p.user_id !== actor.id || !p.conversation_id) throw notFound("Ação");
  return p.conversation_id;
}

export async function confirmAction(core: Core, actor: Actor, pendingId: string): Promise<AssistantMessage[]> {
  const conversationId = conversationOf(core, actor, pendingId);
  const ctx: ToolCtx = { core, actor, conversationId, external: false };
  try {
    const result = executePending(ctx, pendingId);
    setPendingStatus(core, pendingId, "done");
    const conv = loadConversation(core, actor, conversationId);
    const state = json<ConvState>(conv.state, {});
    core.db.run("UPDATE conversations SET state = ? WHERE id = ?", [
      JSON.stringify({ ...state, pendingId: null, spreadsheetId: result.spreadsheetId ?? state.spreadsheetId, recordIds: result.recordIds, clientId: result.clientId ?? state.clientId }),
      conversationId,
    ]);
    const actions: AssistantAction[] = [];
    if (result.spreadsheetId) actions.push({ kind: "open_spreadsheet", spreadsheetId: result.spreadsheetId, clientId: result.clientId ?? state.clientId ?? null, label: "Abrir planilha" });
    if (result.undo) actions.push({ kind: "undo", pendingId, label: "Desfazer" });
    return [addMessage(core, conversationId, "assistant", `✅ ${result.message}`, { actions, engine: "system" })];
  } catch (e) {
    const status = core.db.get<{ status: string }>("SELECT status FROM pending_actions WHERE id = ?", [pendingId])?.status ?? "failed";
    setPendingStatus(core, pendingId, status);
    const msg = e instanceof AppError ? e.message : "Erro inesperado. Nada foi alterado.";
    return [addMessage(core, conversationId, "assistant", `❌ ${msg}`, { engine: "system" })];
  }
}

export function cancelAction(core: Core, actor: Actor, pendingId: string): AssistantMessage[] {
  const conversationId = conversationOf(core, actor, pendingId);
  const ctx: ToolCtx = { core, actor, conversationId, external: false };
  cancelPending(ctx, pendingId);
  setPendingStatus(core, pendingId, "cancelled");
  const conv = loadConversation(core, actor, conversationId);
  core.db.run("UPDATE conversations SET state = ? WHERE id = ?", [JSON.stringify({ ...json<ConvState>(conv.state, {}), pendingId: null }), conversationId]);
  return [addMessage(core, conversationId, "assistant", "Tudo bem, cancelei. Nada foi alterado.", { engine: "system" })];
}

export function undoAction(core: Core, actor: Actor, pendingId: string): AssistantMessage[] {
  const conversationId = conversationOf(core, actor, pendingId);
  const ctx: ToolCtx = { core, actor, conversationId, external: false };
  try {
    const msg = undoPending(ctx, pendingId);
    const result = json<{ spreadsheetId?: string; clientId?: string } | null>(
      core.db.get<{ result: string }>("SELECT result FROM pending_actions WHERE id = ?", [pendingId])?.result,
      null,
    );
    const actions: AssistantAction[] = result?.spreadsheetId
      ? [{ kind: "open_spreadsheet", spreadsheetId: result.spreadsheetId, clientId: result.clientId ?? null, label: "Abrir planilha" }]
      : [];
    return [addMessage(core, conversationId, "assistant", `↩️ ${msg}`, { actions, engine: "system" })];
  } catch (e) {
    const msg = e instanceof AppError ? e.message : "Erro inesperado ao desfazer.";
    return [addMessage(core, conversationId, "assistant", `❌ ${msg}`, { engine: "system" })];
  }
}
