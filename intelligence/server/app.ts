import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";
import type { Actor, Core } from "./core.js";
import { AppError } from "./lib/util.js";
import { actorFromSession } from "./auth/service.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerDataRoutes } from "./routes/data.js";
import { registerSheetRoutes } from "./routes/sheets.js";
import { registerAssistantRoutes } from "./routes/assistant.js";

declare module "fastify" {
  interface FastifyRequest {
    actor: Actor | null;
  }
}

export const SESSION_COOKIE = "ci_session";
export const GATE_COOKIE = "ci_gate";

const PUBLIC_API = new Set(["/api/auth/gate", "/api/auth/register", "/api/auth/login", "/api/auth/me", "/api/auth/logout", "/api/health"]);

export function actorOf(req: FastifyRequest): Actor {
  if (!req.actor) throw new AppError(401, "unauthenticated", "Sua sessão expirou. Entre novamente.");
  return req.actor;
}

export async function buildApp(core: Core, opts: { logger?: boolean; trustProxy?: boolean; webDir?: string } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger
      ? {
          level: "info",
          redact: ["req.headers.cookie", "req.headers.authorization", 'res.headers["set-cookie"]'],
        }
      : false,
    trustProxy: opts.trustProxy ?? false,
    bodyLimit: 4 * 1024 * 1024,
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "img-src": ["'self'", "data:", "blob:"],
        "font-src": ["'self'", "data:"],
        "connect-src": ["'self'"],
        "frame-ancestors": ["'none'"],
        "form-action": ["'self'"],
        "object-src": ["'none'"],
        "base-uri": ["'self'"],
        "upgrade-insecure-requests": core.cfg.cookieSecure ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: core.cfg.cookieSecure ? { maxAge: 15552000, includeSubDomains: true } : false,
  });
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: core.cfg.maxUploadMb * 1024 * 1024, files: 1, fields: 5 } });

  app.decorateRequest("actor", null);

  // Proteção contra CSRF: escrita só com cabeçalho próprio (navegadores não enviam de outros sites sem CORS)
  // e com Origin coerente quando presente.
  app.addHook("onRequest", async (req) => {
    if (!req.url.startsWith("/api/")) return;
    if (req.method !== "GET" && req.method !== "HEAD") {
      if (req.headers["x-cuidare"] !== "1") throw new AppError(403, "csrf", "Requisição bloqueada por segurança. Recarregue a página.");
      const origin = req.headers.origin;
      if (origin) {
        const allowed = new Set<string>();
        if (core.cfg.appOrigin) allowed.add(core.cfg.appOrigin.replace(/\/+$/, ""));
        const host = req.headers["x-forwarded-host"] && opts.trustProxy ? String(req.headers["x-forwarded-host"]) : req.headers.host;
        if (host) {
          allowed.add(`https://${host}`);
          allowed.add(`http://${host}`);
        }
        if (!allowed.has(origin)) throw new AppError(403, "origin", "Origem não permitida.");
      }
    }
    req.actor = actorFromSession(core, req.cookies[SESSION_COOKIE], req.ip);
    const pathOnly = req.url.split("?")[0];
    if (!req.actor && !PUBLIC_API.has(pathOnly)) throw new AppError(401, "unauthenticated", "Sua sessão expirou. Entre novamente.");
  });

  app.addHook("onSend", async (req, reply, payload) => {
    if (req.url.startsWith("/api/")) {
      reply.header("Cache-Control", "no-store");
      reply.header("X-Robots-Tag", "noindex, nofollow");
    }
    return payload;
  });

  app.setErrorHandler((err: unknown, req: FastifyRequest, reply: FastifyReply) => {
    if (err instanceof AppError) {
      if (err.status === 429 && err.extra?.retryAfter) reply.header("Retry-After", String(err.extra.retryAfter));
      return reply.status(err.status).send({ error: err.code, message: err.message, ...err.extra });
    }
    if (err instanceof ZodError) {
      const first = err.issues[0];
      return reply.status(400).send({ error: "validation", message: `Dados inválidos${first?.path.length ? ` em "${first.path.join(".")}"` : ""}.` });
    }
    const e = err as { statusCode?: number; code?: string; message?: string };
    if (e.code === "FST_REQ_FILE_TOO_LARGE" || e.statusCode === 413)
      return reply.status(413).send({ error: "too_large", message: `Arquivo grande demais (máx. ${core.cfg.maxUploadMb} MB).` });
    if (e.statusCode && e.statusCode < 500) return reply.status(e.statusCode).send({ error: "bad_request", message: "Requisição inválida." });
    req.log.error({ err }, "erro inesperado");
    return reply.status(500).send({ error: "internal", message: "Erro interno. Nada foi alterado; tente novamente." });
  });

  app.get("/api/health", async () => ({ ok: true }));

  registerAuthRoutes(app, core);
  registerDataRoutes(app, core);
  registerSheetRoutes(app, core);
  registerAssistantRoutes(app, core);

  // Interface (build do Vite) com fallback para o roteamento do React.
  const here = path.dirname(fileURLToPath(import.meta.url));
  // dist/server → dist/web (produção) ou server/ → dist/web (desenvolvimento com tsx).
  const webDir =
    opts.webDir ?? [path.resolve(here, "../web"), path.resolve(here, "../dist/web"), path.resolve(here, "../../dist/web")].find((d) => fs.existsSync(path.join(d, "assets")) && fs.existsSync(path.join(d, "index.html")));
  if (webDir) {
    await app.register(fastifyStatic, {
      root: webDir,
      wildcard: false,
      setHeaders(res, file) {
        if (file.includes(`${path.sep}assets${path.sep}`)) res.header("Cache-Control", "public, max-age=31536000, immutable");
        else res.header("Cache-Control", "no-cache");
      },
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api/")) return reply.type("text/html").header("Cache-Control", "no-cache").sendFile("index.html");
      return reply.status(404).send({ error: "not_found", message: "Endereço não encontrado." });
    });
  } else {
    app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: "not_found", message: "Endereço não encontrado." }));
  }

  return app;
}
