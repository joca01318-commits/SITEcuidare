import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fs from "node:fs";
import { z } from "zod";
import type { Core } from "../core.js";
import { actorOf } from "../app.js";
import { notFound } from "../lib/util.js";
import {
  addColumn,
  applyCellOps,
  computeRecords,
  createSpreadsheet,
  deleteRows,
  deleteSpreadsheet,
  getSpreadsheet,
  getVersionPreview,
  groupTotals,
  insertRows,
  listSpreadsheets,
  listVersions,
  loadSheet,
  moveColumn,
  readRecords,
  removeColumn,
  restoreSpreadsheet,
  restoreVersion,
  setFavorite,
  totalsFor,
  undeleteRows,
  updateColumn,
  updateSpreadsheetMeta,
  type SheetEvent,
} from "../domain/spreadsheets.js";
import { listAudit } from "../domain/audit.js";
import { exportPdf, exportXlsx } from "../domain/exporter.js";
import { readStoredFile } from "../domain/importer.js";
import { can, require } from "../domain/access.js";

const zId = z.object({ id: z.string().max(40) });
const zCell = z.union([z.string().max(5000), z.number(), z.boolean(), z.null()]);
const zColumnType = z.enum(["text", "number", "currency", "date", "select", "boolean", "formula"]);
const zRole = z.enum(["client", "worker", "status", "amount", "payment_date", "date", "quantity", "unit_value", "absences", "notes", "regime", "shift"]);
const zColumnPatch = z.object({
  name: z.string().min(1).max(80).optional(),
  type: zColumnType.optional(),
  options: z.array(z.string().max(100)).max(100).optional(),
  formula: z.string().max(500).optional(),
  width: z.number().min(40).max(1000).optional(),
  role: zRole.nullable().optional(),
  sensitive: z.boolean().optional(),
  carryOver: z.boolean().optional(),
  pendingValues: z.array(z.string().max(100)).max(20).optional(),
  paidValues: z.array(z.string().max(100)).max(20).optional(),
  schemaRev: z.number().int().optional(),
});

export function registerSheetRoutes(app: FastifyInstance, core: Core) {
  app.get("/api/spreadsheets", async (req) => {
    const q = z
      .object({
        q: z.string().max(100).optional(),
        clientId: z.string().max(40).optional(),
        year: z.coerce.number().int().optional(),
        month: z.coerce.number().int().min(1).max(12).optional(),
        category: z.string().max(80).optional(),
        favorites: z.enum(["0", "1"]).optional(),
        trash: z.enum(["0", "1"]).optional(),
        sort: z.enum(["updated", "title", "period"]).optional(),
      })
      .parse(req.query);
    return { spreadsheets: listSpreadsheets(core, actorOf(req), { ...q, favorites: q.favorites === "1", trash: q.trash === "1" }) };
  });

  app.post("/api/spreadsheets", async (req) => {
    const body = z
      .object({
        title: z.string().min(1).max(200),
        category: z.string().max(80).optional(),
        clientId: z.string().max(40).nullable().optional(),
        year: z.number().int().min(2000).max(2100).nullable().optional(),
        month: z.number().int().min(1).max(12).nullable().optional(),
        templateId: z.string().max(40).optional(),
        copyRows: z.enum(["none", "carry", "all"]).optional(),
      })
      .parse(req.body);
    const id = createSpreadsheet(core, actorOf(req), body);
    return { id };
  });

  app.get("/api/spreadsheets/:id", async (req) => {
    const { id } = zId.parse(req.params);
    const { clientId } = z.object({ clientId: z.string().max(40).optional() }).parse(req.query);
    return getSpreadsheet(core, actorOf(req), id, { clientId: clientId ?? null });
  });

  app.patch("/api/spreadsheets/:id", async (req) => {
    const { id } = zId.parse(req.params);
    const body = z
      .object({
        title: z.string().min(1).max(200).optional(),
        category: z.string().max(80).optional(),
        clientId: z.string().max(40).nullable().optional(),
        year: z.number().int().min(2000).max(2100).nullable().optional(),
        month: z.number().int().min(1).max(12).nullable().optional(),
      })
      .parse(req.body);
    updateSpreadsheetMeta(core, actorOf(req), id, body);
    return { ok: true };
  });

  app.delete("/api/spreadsheets/:id", async (req) => {
    const { id } = zId.parse(req.params);
    deleteSpreadsheet(core, actorOf(req), id);
    return { ok: true };
  });

  app.post("/api/spreadsheets/:id/restore", async (req) => {
    const { id } = zId.parse(req.params);
    restoreSpreadsheet(core, actorOf(req), id);
    return { ok: true };
  });

  app.post("/api/spreadsheets/:id/duplicate", async (req) => {
    const { id } = zId.parse(req.params);
    const body = z.object({ title: z.string().max(200).optional() }).parse(req.body ?? {});
    const actor = actorOf(req);
    const { row } = loadSheet(core, actor, id);
    const newId = createSpreadsheet(core, actor, {
      title: body.title?.trim() || `${row.title} (cópia)`,
      category: row.category,
      clientId: row.client_id,
      year: row.year,
      month: row.month,
      templateId: id,
      copyRows: "all",
    });
    return { id: newId };
  });

  app.put("/api/spreadsheets/:id/favorite", async (req) => {
    const { id } = zId.parse(req.params);
    const { on } = z.object({ on: z.boolean() }).parse(req.body);
    setFavorite(core, actorOf(req), id, on);
    return { ok: true };
  });

  // -------------------------------------------------------------- dados

  app.post("/api/spreadsheets/:id/cells", async (req) => {
    const { id } = zId.parse(req.params);
    const body = z
      .object({ ops: z.array(z.object({ recordId: z.string().max(40), columnId: z.string().max(24), value: zCell, expected: zCell })).min(1).max(5000) })
      .parse(req.body);
    return applyCellOps(core, actorOf(req), id, body.ops);
  });

  app.post("/api/spreadsheets/:id/rows", async (req) => {
    const { id } = zId.parse(req.params);
    const body = z
      .object({
        afterId: z.string().max(40).nullable().optional(),
        rows: z.array(z.record(z.string().max(24), zCell)).min(1).max(2000),
        clientId: z.string().max(40).nullable().optional(),
      })
      .parse(req.body);
    return insertRows(core, actorOf(req), id, body);
  });

  app.post("/api/spreadsheets/:id/rows/delete", async (req) => {
    const { id } = zId.parse(req.params);
    const { ids } = z.object({ ids: z.array(z.string().max(40)).min(1).max(5000) }).parse(req.body);
    return deleteRows(core, actorOf(req), id, ids);
  });

  app.post("/api/spreadsheets/:id/rows/restore", async (req) => {
    const { id } = zId.parse(req.params);
    const { ids } = z.object({ ids: z.array(z.string().max(40)).min(1).max(5000) }).parse(req.body);
    return undeleteRows(core, actorOf(req), id, ids);
  });

  // -------------------------------------------------------------- colunas

  app.post("/api/spreadsheets/:id/columns", async (req) => {
    const { id } = zId.parse(req.params);
    const body = zColumnPatch.extend({ name: z.string().min(1).max(80), afterId: z.string().max(24).nullable().optional() }).parse(req.body);
    return addColumn(core, actorOf(req), id, { ...body, role: body.role ?? undefined });
  });

  app.patch("/api/spreadsheets/:id/columns/:colId", async (req) => {
    const { id, colId } = z.object({ id: z.string().max(40), colId: z.string().max(24) }).parse(req.params);
    const body = zColumnPatch.extend({ clientColumn: z.boolean().optional() }).parse(req.body);
    return updateColumn(core, actorOf(req), id, colId, body);
  });

  app.delete("/api/spreadsheets/:id/columns/:colId", async (req) => {
    const { id, colId } = z.object({ id: z.string().max(40), colId: z.string().max(24) }).parse(req.params);
    const { schemaRev } = z.object({ schemaRev: z.coerce.number().int().optional() }).parse(req.query);
    return removeColumn(core, actorOf(req), id, colId, schemaRev);
  });

  app.post("/api/spreadsheets/:id/columns/:colId/move", async (req) => {
    const { id, colId } = z.object({ id: z.string().max(40), colId: z.string().max(24) }).parse(req.params);
    const body = z.object({ toIndex: z.number().int().min(0).max(500), schemaRev: z.number().int().optional() }).parse(req.body);
    return moveColumn(core, actorOf(req), id, colId, body.toIndex, body.schemaRev);
  });

  // -------------------------------------------------------------- totais, versões, histórico

  app.get("/api/spreadsheets/:id/totals", async (req) => {
    const { id } = zId.parse(req.params);
    const q = z.object({ clientId: z.string().max(40).optional(), groupBy: z.string().max(24).optional() }).parse(req.query);
    const actor = actorOf(req);
    const { row, columns } = loadSheet(core, actor, id);
    const rows = computeRecords(columns, readRecords(core, actor, row, { clientId: q.clientId ?? null }));
    return { totals: totalsFor(columns, rows), groups: q.groupBy ? groupTotals(columns, rows, q.groupBy).map((g) => ({ key: g.key, rows: g.rows, totals: g.totals })) : null };
  });

  app.get("/api/spreadsheets/:id/versions", async (req) => {
    const { id } = zId.parse(req.params);
    return { versions: listVersions(core, actorOf(req), id) };
  });

  app.get("/api/spreadsheets/:id/versions/:vid", async (req) => {
    const { id, vid } = z.object({ id: z.string().max(40), vid: z.string().max(40) }).parse(req.params);
    return getVersionPreview(core, actorOf(req), id, vid);
  });

  app.post("/api/spreadsheets/:id/versions/:vid/restore", async (req) => {
    const { id, vid } = z.object({ id: z.string().max(40), vid: z.string().max(40) }).parse(req.params);
    return restoreVersion(core, actorOf(req), id, vid);
  });

  app.get("/api/spreadsheets/:id/history", async (req) => {
    const { id } = zId.parse(req.params);
    const { before } = z.object({ before: z.coerce.number().int().optional() }).parse(req.query);
    const actor = actorOf(req);
    loadSheet(core, actor, id, { allowDeleted: true });
    return { events: listAudit(core, actor, { spreadsheetId: id, before, limit: 50 }) };
  });

  // -------------------------------------------------------------- exportação e arquivo original

  const exportBody = z.object({
    format: z.enum(["xlsx", "pdf"]),
    clientId: z.string().max(40).nullable().optional(),
    recordIds: z.array(z.string().max(40)).max(20000).optional(),
    columnIds: z.array(z.string().max(24)).max(200).optional(),
    filterLabel: z.string().max(200).nullable().optional(),
  });

  async function sendExport(req: FastifyRequest, reply: FastifyReply, id: string, input: z.infer<typeof exportBody>) {
    const actor = actorOf(req);
    const out = input.format === "pdf" ? await exportPdf(core, actor, id, input) : await exportXlsx(core, actor, id, input);
    reply
      .header("Content-Type", input.format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .header("Content-Disposition", `attachment; filename="${encodeURIComponent(out.filename).replace(/%20/g, " ")}"; filename*=UTF-8''${encodeURIComponent(out.filename)}`);
    return reply.send(out.buffer);
  }

  app.get("/api/spreadsheets/:id/export", async (req, reply) => {
    const { id } = zId.parse(req.params);
    const q = exportBody.pick({ format: true, clientId: true }).parse(req.query);
    return sendExport(req, reply, id, q);
  });

  app.post("/api/spreadsheets/:id/export", async (req, reply) => {
    const { id } = zId.parse(req.params);
    return sendExport(req, reply, id, exportBody.parse(req.body));
  });

  app.get("/api/spreadsheets/:id/source", async (req, reply) => {
    const { id } = zId.parse(req.params);
    const actor = actorOf(req);
    require(actor, "export");
    if (!actor.scopeAll) throw notFound("Arquivo");
    const { row } = loadSheet(core, actor, id);
    if (!row.source_file_id) throw notFound("Arquivo original");
    const f = readStoredFile(core, actor, row.source_file_id);
    if (!f || !fs.existsSync(f.path)) throw notFound("Arquivo original");
    reply.header("Content-Type", f.mime).header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`);
    return reply.send(fs.createReadStream(f.path));
  });

  // -------------------------------------------------------------- tempo real (Server-Sent Events)

  app.get("/api/spreadsheets/:id/stream", async (req, reply) => {
    const { id } = zId.parse(req.params);
    const actor = actorOf(req);
    loadSheet(core, actor, id);
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(`retry: 3000\n\n`);
    const onEvent = (ev: SheetEvent) => {
      // Usuários com acesso restrito (ou sem acesso a dados sensíveis) recebem só um aviso para recarregar.
      const full = actor.scopeAll && can(actor, "view_sensitive");
      const safe = full || ev.type !== "cells" ? ev : { type: "rows", by: ev.by, byName: ev.byName, dataRev: ev.dataRev };
      res.write(`data: ${JSON.stringify(safe)}\n\n`);
    };
    core.bus.on(`sheet:${id}`, onEvent);
    const ping = setInterval(() => res.write(`: ping\n\n`), 25_000);
    req.raw.on("close", () => {
      clearInterval(ping);
      core.bus.off(`sheet:${id}`, onEvent);
    });
  });
}
