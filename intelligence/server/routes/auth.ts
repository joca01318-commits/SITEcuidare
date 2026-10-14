import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { Core } from "../core.js";
import { actorOf, GATE_COOKIE, SESSION_COOKIE } from "../app.js";
import { AppError } from "../lib/util.js";
import {
  changePassword,
  checkInviteCode,
  createInvite,
  listInvites,
  listUsers,
  login,
  register,
  revokeInvite,
  revokeSession,
  updateUser,
} from "../auth/service.js";
import { require } from "../domain/access.js";
import { listBackups, runBackup } from "../domain/maintenance.js";
import { assistantInfo } from "../ai/assistant.js";

const zRole = z.enum(["admin", "editor", "viewer"]);

export function registerAuthRoutes(app: FastifyInstance, core: Core) {
  const cookieBase = { httpOnly: true, sameSite: "lax" as const, secure: core.cfg.cookieSecure, path: "/" };

  function setSession(reply: FastifyReply, s: { token: string; expiresAt: Date }) {
    reply.setCookie(SESSION_COOKIE, s.token, { ...cookieBase, expires: s.expiresAt });
  }

  app.post("/api/auth/gate", async (req, reply) => {
    const body = z.object({ code: z.string().min(1).max(64) }).parse(req.body);
    const r = checkInviteCode(core, body.code, req.ip);
    reply.setCookie(GATE_COOKIE, r.pass, { ...cookieBase, path: "/api/auth", maxAge: 30 * 60 });
    return { ok: true, label: r.label };
  });

  app.post("/api/auth/register", async (req, reply) => {
    const body = z.object({ name: z.string().max(120), email: z.string().max(254), password: z.string().max(200) }).parse(req.body);
    const pass = req.cookies[GATE_COOKIE];
    if (!pass) throw new AppError(401, "invalid_code", "Digite o código de acesso primeiro.");
    const s = await register(core, pass, body, { ip: req.ip, ua: String(req.headers["user-agent"] ?? "") });
    reply.clearCookie(GATE_COOKIE, { path: "/api/auth" });
    setSession(reply, s);
    return { ok: true };
  });

  app.post("/api/auth/login", async (req, reply) => {
    const body = z.object({ email: z.string().max(254), password: z.string().max(200) }).parse(req.body);
    const s = await login(core, body, { ip: req.ip, ua: String(req.headers["user-agent"] ?? "") });
    setSession(reply, s);
    return { ok: true };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) revokeSession(core, token);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/auth/me", async (req, reply) => {
    if (!req.actor) return reply.status(401).send({ error: "unauthenticated", message: "Não autenticado." });
    const a = req.actor;
    return {
      user: { id: a.id, name: a.name, email: a.email, role: a.role, scopeAll: a.scopeAll },
      assistant: assistantInfo(core),
    };
  });

  app.post("/api/auth/password", async (req) => {
    const body = z.object({ current: z.string().max(200), next: z.string().max(200) }).parse(req.body);
    await changePassword(core, actorOf(req), body.current, body.next, req.cookies[SESSION_COOKIE] ?? "");
    return { ok: true };
  });

  // -------------------------------------------------------------- administração

  app.get("/api/admin/users", async (req) => {
    const actor = actorOf(req);
    require(actor, "manage_users");
    return { users: listUsers(core, actor) };
  });

  app.patch("/api/admin/users/:id", async (req) => {
    const actor = actorOf(req);
    require(actor, "manage_users");
    const { id } = z.object({ id: z.string().max(40) }).parse(req.params);
    const body = z
      .object({ role: zRole.optional(), active: z.boolean().optional(), scopeAll: z.boolean().optional(), clientIds: z.array(z.string().max(40)).max(500).optional() })
      .parse(req.body);
    if (id === actor.id && (body.active === false || (body.role && body.role !== "admin"))) throw new AppError(400, "self", "Você não pode remover o seu próprio acesso de administrador.");
    updateUser(core, actor, id, body);
    return { ok: true };
  });

  app.get("/api/admin/invites", async (req) => {
    const actor = actorOf(req);
    require(actor, "manage_users");
    return { invites: listInvites(core, actor) };
  });

  app.post("/api/admin/invites", async (req) => {
    const actor = actorOf(req);
    require(actor, "manage_users");
    const body = z
      .object({
        label: z.string().min(1).max(80),
        role: zRole,
        scopeAll: z.boolean(),
        clientIds: z.array(z.string().max(40)).max(500).optional(),
        maxUses: z.number().int().min(1).max(1000).nullable().optional(),
        expiresInDays: z.number().int().min(1).max(365).nullable().optional(),
        customCode: z.string().max(40).nullable().optional(),
      })
      .parse(req.body);
    return createInvite(core, actor, body);
  });

  app.delete("/api/admin/invites/:id", async (req) => {
    const actor = actorOf(req);
    require(actor, "manage_users");
    const { id } = z.object({ id: z.string().max(40) }).parse(req.params);
    revokeInvite(core, actor, id);
    return { ok: true };
  });

  app.get("/api/admin/backups", async (req) => {
    require(actorOf(req), "manage_users");
    return { backups: listBackups(core), every: core.cfg.backupEveryHours, keep: core.cfg.backupKeep };
  });

  app.post("/api/admin/backups", async (req) => {
    const actor = actorOf(req);
    require(actor, "manage_users");
    return { name: runBackup(core, actor, "manual") };
  });
}
