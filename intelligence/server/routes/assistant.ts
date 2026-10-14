import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Core } from "../core.js";
import { actorOf } from "../app.js";
import { rateLimit } from "../auth/service.js";
import {
  assistantInfo,
  cancelAction,
  confirmAction,
  deleteConversation,
  getConversation,
  listConversations,
  sendMessage,
  undoAction,
} from "../ai/assistant.js";

export function registerAssistantRoutes(app: FastifyInstance, core: Core) {
  app.get("/api/assistant/info", async () => assistantInfo(core));

  app.get("/api/assistant/conversations", async (req) => ({ conversations: listConversations(core, actorOf(req)) }));

  app.get("/api/assistant/conversations/:id", async (req) => {
    const { id } = z.object({ id: z.string().max(40) }).parse(req.params);
    return getConversation(core, actorOf(req), id);
  });

  app.delete("/api/assistant/conversations/:id", async (req) => {
    const { id } = z.object({ id: z.string().max(40) }).parse(req.params);
    deleteConversation(core, actorOf(req), id);
    return { ok: true };
  });

  app.post("/api/assistant/messages", async (req) => {
    const actor = actorOf(req);
    rateLimit(core, `ai:${actor.id}`, 40, 60);
    const body = z
      .object({
        conversationId: z.string().max(40).nullable().optional(),
        text: z.string().min(1).max(1000),
        page: z.object({ spreadsheetId: z.string().max(40).nullable().optional(), clientId: z.string().max(40).nullable().optional() }).optional(),
      })
      .parse(req.body);
    return sendMessage(core, actor, body);
  });

  app.post("/api/assistant/actions/:id/:op", async (req) => {
    const { id, op } = z.object({ id: z.string().max(40), op: z.enum(["confirm", "cancel", "undo"]) }).parse(req.params);
    const actor = actorOf(req);
    const messages = op === "confirm" ? await confirmAction(core, actor, id) : op === "cancel" ? cancelAction(core, actor, id) : undoAction(core, actor, id);
    return { messages };
  });
}
