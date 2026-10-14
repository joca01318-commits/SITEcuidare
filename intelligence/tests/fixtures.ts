// Dados fictícios para os testes. Nenhum dado real de cliente é usado.
import ExcelJS from "exceljs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../server/config.js";
import { createCore, ensureOrganization, type Actor, type Core } from "../server/core.js";
import { actorFromSession, checkInviteCode, createInvite, register } from "../server/auth/service.js";

export const HEADERS = [
  "Assistido",
  "Cuidador",
  "Regime",
  "Turno",
  "Qtd Plantões",
  "Valor Plantão",
  "Faltas",
  "Obs Cobertura",
  "situação Pgto.",
  "Vr PgtoTotal",
  "DATA PGMTO",
  "CHAVE PIX",
];

type Row = [string, string, string, string, number | null, number | null, number | null, string | null, string | null, number | null, Date | null, string | null];

export const OUTUBRO: Row[] = [
  ["ARLINDO", "PAULA SOUZA", "CLT", "D", 15, 180, null, null, "PAGO", 2700, new Date(Date.UTC(2026, 9, 5)), "paula@example.com"],
  ["ARLINDO", "RITA LIMA", "CLT", "N", 15, 180, 1, "ATESTADO 11/10", "PENDENTE", 2520, null, "11999990000"],
  ["BENEDITA", "SONIA ALVES", "MEI", "D", 12, 200, null, null, "PAGO", 2400, new Date(Date.UTC(2026, 9, 6)), "sonia@example.com"],
  ["MARIA TEREZA", "JOANA DIAS", "AUTÔNOMA", "D", 10, 150, null, null, "PARCIAL", 1500, null, null],
  ["MARIA JOSÉ (ZEZE)", "CLARA NUNES", "MEI", "N", 8, 170, null, "COBERTURA", "PAGO", 1360, new Date(Date.UTC(2026, 9, 10)), null],
  ["SR. OSVALDO", "PAULA SOUZA", "CLT", "D", 4, 180, null, null, null, null, null, "paula@example.com"],
];

export const SETEMBRO: Row[] = [
  ["ARLINDO", "PAULA SOUZA", "CLT", "D", 15, 180, null, null, "PAGO", 2700, new Date(Date.UTC(2026, 8, 5)), "paula@example.com"],
  ["ARLINDO", "RITA LIMA", "CLT", "N", 15, 180, null, null, "PAGO", 2700, new Date(Date.UTC(2026, 8, 5)), "11999990000"],
  ["BENEDITA", "SONIA ALVES", "MEI", "D", 12, 200, null, null, "PAGO", 2400, new Date(Date.UTC(2026, 8, 6)), "sonia@example.com"],
];

function addControlSheet(wb: ExcelJS.Workbook, name: string, rows: Row[]) {
  const ws = wb.addWorksheet(name);
  ws.addRow(HEADERS);
  for (const r of rows) ws.addRow(r);
  ws.addRow([]);
  ws.addRow([]);
  for (let i = 2; i <= rows.length + 1; i++) {
    ws.getCell(`I${i}`).dataValidation = { type: "list", allowBlank: true, formulae: ['"PAGO,PENDENTE,PARCIAL"'] };
    ws.getCell(`C${i}`).dataValidation = { type: "list", allowBlank: true, formulae: ['"CLT,MEI,AUTÔNOMA,RPA"'] };
    ws.getCell(`J${i}`).numFmt = "[$R$ -416]#,##0.00";
    ws.getCell(`K${i}`).numFmt = "dd/mm/yyyy";
  }
  return ws;
}

/** Pasta de trabalho no mesmo formato das planilhas de controle de pagamentos. */
export async function buildWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  addControlSheet(wb, "CONTROLE ESCALA - SETEMBRO", SETEMBRO);
  addControlSheet(wb, "CONTROLE ESCALA - OUTUBRO", OUTUBRO);

  // Aba com fórmula por linha (como a de maio): ((E-G)*F)-J
  const maio = wb.addWorksheet("CONTROLE ESCALA - MAIO");
  maio.addRow(["Assistido", "Cuidador", "Regime", "Turno", "Qtd Plantões", "Valor Plantão", "Faltas", "Obs", "Vr Plantão Cob.", "Desconto", "Vr Pgto Mensal"]);
  const data: [string, string, number, number, number, number][] = [
    ["ARLINDO", "PAULA SOUZA", 15, 180, 0, 0],
    ["BENEDITA", "SONIA ALVES", 12, 200, 1, 50],
    ["SR. OSVALDO", "RITA LIMA", 10, 150, 0, 0],
  ];
  data.forEach((d, i) => {
    const r = i + 2;
    maio.addRow([d[0], d[1], "CLT", "D", d[2], d[3], d[4], null, null, d[5]]);
    maio.getCell(`K${r}`).value = { formula: `((E${r}-G${r})*F${r})-J${r}`, result: (d[2] - d[4]) * d[3] - d[5] } as ExcelJS.CellFormulaValue;
  });

  // Aba de fechamento com fórmulas que apontam para outra aba (não convertíveis).
  const fech = wb.addWorksheet("FECHAMENTO");
  fech.addRow(["Indicador", "Valor"]);
  fech.addRow(["Total de Plantões", { formula: "SUM('CONTROLE ESCALA - MAIO'!E:E)", result: 37 }]);
  fech.addRow(["Total", { formula: "SUM(B2:B2)", result: 37 }]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export interface TestEnv {
  core: Core;
  dir: string;
  admin: Actor;
  makeUser: (role: "admin" | "editor" | "viewer", opts?: { scopeAll?: boolean; clientIds?: string[] }) => Promise<Actor>;
  cleanup: () => void;
}

let counter = 0;

export async function makeEnv(overrides: Record<string, unknown> = {}): Promise<TestEnv> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cuidare-test-"));
  const cfg = loadConfig({ dataDir: dir, cookieSecure: false, backupEveryHours: 0, ...overrides } as never);
  cfg.ai = { ...cfg.ai, mode: "rules", baseUrl: "", model: "" };
  const core = createCore(cfg);
  const orgId = ensureOrganization(core);

  async function makeUser(role: "admin" | "editor" | "viewer", opts: { scopeAll?: boolean; clientIds?: string[] } = {}): Promise<Actor> {
    counter++;
    const inv = createInvite(core, null, { label: `t${counter}`, role, scopeAll: opts.scopeAll ?? true, clientIds: opts.clientIds, maxUses: 1 }, orgId);
    const gate = checkInviteCode(core, inv.code, `10.0.0.${counter % 250}`);
    const s = await register(core, gate.pass, { name: `Usuário ${role} ${counter}`, email: `u${counter}-${Date.now()}@teste.com`, password: "senha-forte-de-teste-9" }, { ip: "127.0.0.1", ua: "vitest" });
    return actorFromSession(core, s.token, "127.0.0.1")!;
  }

  const admin = await makeUser("admin");
  return {
    core,
    dir,
    admin,
    makeUser,
    cleanup: () => {
      core.db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
