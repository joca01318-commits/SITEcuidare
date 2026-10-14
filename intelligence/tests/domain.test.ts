import { afterEach, beforeEach, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { buildWorkbook, makeEnv, type TestEnv } from "./fixtures.js";
import { commitImport, storeUpload } from "../server/domain/importer.js";
import {
  applyCellOps,
  computeRecords,
  deleteRows,
  getSpreadsheet,
  insertRows,
  listSpreadsheets,
  listVersions,
  readRecords,
  restoreVersion,
  totalsFor,
  undeleteRows,
  loadSheet,
} from "../server/domain/spreadsheets.js";
import { exportPdf, exportXlsx } from "../server/domain/exporter.js";
import { listClients } from "../server/domain/clients.js";
import { listAudit } from "../server/domain/audit.js";
import { AppError } from "../server/lib/util.js";

let env: TestEnv;
let ids: Record<string, string>;

async function importFixture(e: TestEnv) {
  const up = await storeUpload(e.core, e.admin, await buildWorkbook(), "Controle_de_pagamentos.xlsx");
  const created = await commitImport(e.core, e.admin, up.fileId, {
    category: up.parsed.category,
    sheets: up.parsed.sheets.map((s) => ({ index: s.index, include: true, title: s.title, year: 2026, month: s.month, clientColumn: s.clientColumn, clientId: null })),
  });
  return Object.fromEntries(created.map((c) => [c.title, c.id]));
}

beforeEach(async () => {
  env = await makeEnv();
  ids = await importFixture(env);
});
afterEach(() => env.cleanup());

const out = () => ids["Controle Escala - Outubro"];

describe("importação", () => {
  it("cria uma planilha por aba, com mês, clientes e tipos de coluna", () => {
    expect(Object.keys(ids)).toEqual(["Controle Escala - Setembro", "Controle Escala - Outubro", "Controle Escala - Maio", "Fechamento"]);
    const d = getSpreadsheet(env.core, env.admin, out());
    expect(d.month).toBe(10);
    expect(d.records).toHaveLength(6);
    const byName = Object.fromEntries(d.columns.map((c) => [c.name, c]));
    expect(byName["Assistido"].role).toBe("client");
    expect(byName["Vr PgtoTotal"]).toMatchObject({ type: "currency", role: "amount" });
    expect(byName["situação Pgto."]).toMatchObject({ type: "select", role: "status", pendingValues: ["PENDENTE", "PARCIAL"], paidValues: ["PAGO"] });
    expect(byName["DATA PGMTO"]).toMatchObject({ type: "date", role: "payment_date" });
    expect(byName["CHAVE PIX"].sensitive).toBe(true);
    const names = listClients(env.core, env.admin).map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(["Arlindo", "Benedita", "Maria Tereza", "Maria José (Zeze)", "Sr. Osvaldo"]));
  });

  it("transforma a fórmula repetida da coluna em coluna calculada", () => {
    const d = getSpreadsheet(env.core, env.admin, ids["Controle Escala - Maio"]);
    const col = d.columns.find((c) => c.name === "Vr Pgto Mensal")!;
    expect(col.type).toBe("formula");
    const rows = computeRecords(d.columns, d.records);
    expect(rows.map((r) => r.values[col.id])).toEqual([2700, 2150, 1500]);
  });

  it("avisa o que não pôde ser preservado", () => {
    const d = getSpreadsheet(env.core, env.admin, ids["Fechamento"]);
    expect(d.importNotes.join(" ")).toMatch(/não puderam ser mantidas/);
  });
});

describe("cálculos", () => {
  it("soma valores em centavos", () => {
    const d = getSpreadsheet(env.core, env.admin, out());
    const t = totalsFor(d.columns, computeRecords(d.columns, d.records));
    const amount = t.find((x) => x.name === "Vr PgtoTotal")!;
    expect(amount.sum).toBe(10480);
    expect(amount.count).toBe(5);
  });

  it("atualiza o total após inserir uma linha", () => {
    const d = getSpreadsheet(env.core, env.admin, out());
    const amountCol = d.columns.find((c) => c.role === "amount")!;
    insertRows(env.core, env.admin, out(), { rows: [{ [amountCol.id]: "R$ 350,00", c1: "ARLINDO" }] });
    const after = getSpreadsheet(env.core, env.admin, out());
    expect(totalsFor(after.columns, computeRecords(after.columns, after.records)).find((x) => x.columnId === amountCol.id)!.sum).toBe(10830);
  });
});

describe("edição e concorrência", () => {
  it("rejeita valor inválido para o tipo da coluna", () => {
    const d = getSpreadsheet(env.core, env.admin, out());
    const amountCol = d.columns.find((c) => c.role === "amount")!;
    expect(() => applyCellOps(env.core, env.admin, out(), [{ recordId: d.records[0].id, columnId: amountCol.id, value: "muito", expected: 2700 }])).toThrow(AppError);
  });

  it("não sobrescreve em silêncio a alteração de outra pessoa", async () => {
    const editor = await env.makeUser("editor");
    const d = getSpreadsheet(env.core, env.admin, out());
    const rec = d.records[0];
    const amountCol = d.columns.find((c) => c.role === "amount")!;
    const notes = d.columns.find((c) => c.role === "notes")!;
    // Admin altera o valor.
    const a = applyCellOps(env.core, env.admin, out(), [{ recordId: rec.id, columnId: amountCol.id, value: 2800, expected: 2700 }]);
    expect(a.applied).toHaveLength(1);
    // Editor, que ainda via 2700, tenta mudar a mesma célula → conflito.
    const b = applyCellOps(env.core, editor, out(), [{ recordId: rec.id, columnId: amountCol.id, value: 2900, expected: 2700 }]);
    expect(b.applied).toHaveLength(0);
    expect(b.conflicts[0]).toMatchObject({ current: 2800, attempted: 2900 });
    // Mas pode editar outra coluna da mesma linha normalmente.
    const c = applyCellOps(env.core, editor, out(), [{ recordId: rec.id, columnId: notes.id, value: "ok", expected: null }]);
    expect(c.applied).toHaveLength(1);
    const final = getSpreadsheet(env.core, env.admin, out()).records[0].data;
    expect(final[amountCol.id]).toBe(2800);
    expect(final[notes.id]).toBe("ok");
  });

  it("exclui e recupera linhas", () => {
    const d = getSpreadsheet(env.core, env.admin, out());
    deleteRows(env.core, env.admin, out(), [d.records[0].id]);
    expect(getSpreadsheet(env.core, env.admin, out()).records).toHaveLength(5);
    undeleteRows(env.core, env.admin, out(), [d.records[0].id]);
    expect(getSpreadsheet(env.core, env.admin, out()).records).toHaveLength(6);
  });
});

describe("versões e auditoria", () => {
  it("restaura uma versão sem apagar o histórico", () => {
    const d = getSpreadsheet(env.core, env.admin, out());
    const amountCol = d.columns.find((c) => c.role === "amount")!;
    applyCellOps(env.core, env.admin, out(), [{ recordId: d.records[0].id, columnId: amountCol.id, value: 1, expected: 2700 }], "ui", { snapshotReason: "antes do teste" });
    const versions = listVersions(env.core, env.admin, out());
    const first = versions[versions.length - 1];
    const r = restoreVersion(env.core, env.admin, out(), first.id);
    expect(getSpreadsheet(env.core, env.admin, out()).records[0].data[amountCol.id]).toBe(2700);
    expect(listVersions(env.core, env.admin, out()).length).toBe(versions.length + 1);
    expect(r.backupNumber).toBeGreaterThan(first.number);
    const events = listAudit(env.core, env.admin, { spreadsheetId: out() });
    expect(events[0].action).toBe("version.restore");
    expect(events.some((e) => e.action === "cells.update")).toBe(true);
  });

  it("o histórico de auditoria não pode ser alterado nem apagado", () => {
    expect(() => env.core.db.run("UPDATE audit_events SET summary = 'x'")).toThrow(/append-only/);
    expect(() => env.core.db.run("DELETE FROM audit_events")).toThrow(/append-only/);
  });

  it("registra valores anteriores e posteriores", () => {
    const d = getSpreadsheet(env.core, env.admin, out());
    const notes = d.columns.find((c) => c.role === "notes")!;
    applyCellOps(env.core, env.admin, out(), [{ recordId: d.records[0].id, columnId: notes.id, value: "novo", expected: null }]);
    const ev = listAudit(env.core, env.admin, { spreadsheetId: out() })[0];
    expect(ev.details?.[0]).toMatchObject({ before: null, after: "novo", column: notes.name });
    expect(ev.userName).toBe(env.admin.name);
    expect(ev.source).toBe("ui");
  });
});

describe("permissões", () => {
  it("perfil de leitura não altera e não vê dados sensíveis", async () => {
    const viewer = await env.makeUser("viewer");
    const d = getSpreadsheet(env.core, viewer, out());
    const pix = d.columns.find((c) => c.sensitive)!;
    expect(String(d.records[0].data[pix.id])).toMatch(/^••••/);
    expect(() => applyCellOps(env.core, viewer, out(), [{ recordId: d.records[0].id, columnId: "c8", value: "x", expected: null }])).toThrow(/permissão/);
  });

  it("acesso restrito vê só as linhas e planilhas dos seus clientes", async () => {
    const arlindo = listClients(env.core, env.admin).find((c) => c.name === "Arlindo")!;
    const restricted = await env.makeUser("editor", { scopeAll: false, clientIds: [arlindo.id] });
    const sheets = listSpreadsheets(env.core, restricted, {});
    expect(sheets.map((s) => s.title).sort()).toEqual(["Controle Escala - Maio", "Controle Escala - Outubro", "Controle Escala - Setembro"]);
    const d = getSpreadsheet(env.core, restricted, out());
    expect(d.records.every((r) => r.clientId === arlindo.id)).toBe(true);
    expect(() => loadSheet(env.core, restricted, ids["Fechamento"])).toThrow(/não encontrad/);
    // Não consegue editar linha de outro cliente, mesmo sabendo o id.
    const other = readRecords(env.core, env.admin, loadSheet(env.core, env.admin, out()).row).find((r) => r.clientId !== arlindo.id)!;
    expect(() => applyCellOps(env.core, restricted, out(), [{ recordId: other.id, columnId: "c8", value: "x", expected: null }])).toThrow(/permissão/);
  });

  it("usuário de outra organização não acessa", () => {
    const stranger = { ...env.admin, orgId: "org_outra" };
    expect(() => getSpreadsheet(env.core, stranger, out())).toThrow(/não encontrad/);
  });
});

describe("exportação", () => {
  it("gera Excel com fórmulas reais, totais e listas", async () => {
    const r = await exportXlsx(env.core, env.admin, ids["Controle Escala - Maio"], { format: "xlsx" });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.buffer as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    expect(ws.getCell("A1").value).toBe("Controle Escala - Maio");
    expect(ws.getCell("A4").value).toBe("Assistido");
    const k5 = ws.getCell("K5");
    expect(k5.formula).toBe("((E5-G5)*F5)-J5");
    expect((k5.value as { result: number }).result).toBe(2700);
    expect(r.filename).toBe("Controle Escala - Maio.xlsx");
  });

  it("gera PDF filtrado por cliente", async () => {
    const arlindo = listClients(env.core, env.admin).find((c) => c.name === "Arlindo")!;
    const r = await exportPdf(env.core, env.admin, out(), { format: "pdf", clientId: arlindo.id });
    expect(r.buffer.subarray(0, 4).toString()).toBe("%PDF");
    expect(r.filename).toBe("Controle Escala - Outubro - Arlindo.pdf");
  });
});

describe("PDF", () => {
  it("não cria páginas em branco por causa do rodapé", async () => {
    const r = await exportPdf(env.core, env.admin, out(), { format: "pdf" });
    const pages = (r.buffer.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;
    expect(pages).toBe(1);
  });
});
