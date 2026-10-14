import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Core } from "../core.js";
import { actorOf } from "../app.js";
import { AppError, badRequest } from "../lib/util.js";
import { dashboard, pendingAlerts } from "../domain/dashboard.js";
import { globalSearch } from "../domain/search.js";
import { createClient, getClient, listClients, updateClient } from "../domain/clients.js";
import { listSpreadsheets, trackRecent } from "../domain/spreadsheets.js";
import { listAudit } from "../domain/audit.js";
import { commitImport, previewOf, storeUpload } from "../domain/importer.js";
import { calculateTotals } from "../ai/tools.js";

export function registerDataRoutes(app: FastifyInstance, core: Core) {
  app.get("/api/dashboard", async (req) => dashboard(core, actorOf(req)));

  app.get("/api/search", async (req) => {
    const { q } = z.object({ q: z.string().max(100) }).parse(req.query);
    return { hits: globalSearch(core, actorOf(req), q) };
  });

  // -------------------------------------------------------------- clientes

  app.get("/api/clients", async (req) => {
    const q = z.object({ q: z.string().max(100).optional(), archived: z.enum(["0", "1"]).optional() }).parse(req.query);
    return { clients: listClients(core, actorOf(req), { q: q.q, includeArchived: q.archived === "1" }) };
  });

  app.post("/api/clients", async (req) => {
    const body = z.object({ name: z.string().min(1).max(160), aliases: z.array(z.string().max(80)).max(20).optional(), notes: z.string().max(2000).nullable().optional() }).parse(req.body);
    return { client: createClient(core, actorOf(req), body) };
  });

  app.get("/api/clients/:id", async (req) => {
    const actor = actorOf(req);
    const { id } = z.object({ id: z.string().max(40) }).parse(req.params);
    const client = getClient(core, actor, id);
    trackRecent(core, actor, "client", id);
    const sheets = listSpreadsheets(core, actor, { clientId: id, sort: "period" });
    const year = new Date().getFullYear();
    const totalsYear = calculateTotals({ core, actor, conversationId: null, external: false }, { clientId: id, year });
    return {
      client,
      sheets,
      pending: pendingAlerts(core, actor, { clientId: id }),
      totals: { year, total: totalsYear.total, count: totalsYear.count, columns: [...new Set(totalsYear.perSheet.map((p) => p.column))] },
      activity: listAudit(core, actor, { clientId: id, limit: 15 }),
    };
  });

  app.patch("/api/clients/:id", async (req) => {
    const { id } = z.object({ id: z.string().max(40) }).parse(req.params);
    const body = z
      .object({
        name: z.string().min(1).max(160).optional(),
        aliases: z.array(z.string().max(80)).max(20).optional(),
        notes: z.string().max(2000).nullable().optional(),
        archived: z.boolean().optional(),
      })
      .parse(req.body);
    return { client: updateClient(core, actorOf(req), id, body) };
  });

  // -------------------------------------------------------------- auditoria

  app.get("/api/audit", async (req) => {
    const q = z
      .object({
        before: z.coerce.number().int().optional(),
        source: z.enum(["ui", "import", "ai", "system"]).optional(),
        clientId: z.string().max(40).optional(),
      })
      .parse(req.query);
    return { events: listAudit(core, actorOf(req), { ...q, limit: 50 }) };
  });

  // -------------------------------------------------------------- importação

  app.post("/api/imports", async (req) => {
    const actor = actorOf(req);
    const file = await req.file();
    if (!file) throw badRequest("Envie um arquivo.");
    const buffer = await file.toBuffer();
    if (file.file.truncated) throw new AppError(413, "too_large", `Arquivo grande demais (máx. ${core.cfg.maxUploadMb} MB).`);
    const r = await storeUpload(core, actor, buffer, file.filename);
    return { fileId: r.fileId, duplicateOf: r.duplicateOf, preview: previewOf(r.parsed) };
  });

  app.post("/api/imports/:fileId/commit", async (req) => {
    const { fileId } = z.object({ fileId: z.string().max(40) }).parse(req.params);
    const body = z
      .object({
        category: z.string().max(80),
        sheets: z
          .array(
            z.object({
              index: z.number().int().min(0).max(200),
              include: z.boolean(),
              title: z.string().max(200),
              year: z.number().int().min(2000).max(2100).nullable(),
              month: z.number().int().min(1).max(12).nullable(),
              clientColumn: z.string().max(24).nullable(),
              clientId: z.string().max(40).nullable(),
            }),
          )
          .max(200),
      })
      .parse(req.body);
    return { created: await commitImport(core, actorOf(req), fileId, body) };
  });
}
