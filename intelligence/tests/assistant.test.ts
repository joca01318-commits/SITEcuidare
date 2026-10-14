import { afterEach, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import { buildWorkbook, makeEnv, type TestEnv } from "./fixtures.js";
import { commitImport, storeUpload } from "../server/domain/importer.js";
import { cancelAction, confirmAction, sendMessage, undoAction } from "../server/ai/assistant.js";
import { getSpreadsheet } from "../server/domain/spreadsheets.js";
import { parse, findMentions, pickClear } from "../server/ai/nlu.js";
import type { Actor } from "../server/core.js";
import type { AssistantMessage } from "../shared/types.js";

let env: TestEnv;
let ids: Record<string, string>;
const YEAR = new Date().getFullYear();

beforeEach(async () => {
  env = await makeEnv();
  const up = await storeUpload(env.core, env.admin, await buildWorkbook(), "Controle_de_pagamentos.xlsx");
  const created = await commitImport(env.core, env.admin, up.fileId, {
    category: up.parsed.category,
    sheets: up.parsed.sheets.map((s) => ({ index: s.index, include: true, title: s.title, year: YEAR, month: s.month, clientColumn: s.clientColumn, clientId: null })),
  });
  ids = Object.fromEntries(created.map((c) => [c.title, c.id]));
});
afterEach(() => env.cleanup());

function chat(actor: Actor = env.admin) {
  let conv: string | null = null;
  return async (text: string, page: { spreadsheetId?: string; clientId?: string } = {}): Promise<AssistantMessage> => {
    const r = await sendMessage(env.core, actor, { conversationId: conv, text, page });
    conv = r.conversationId;
    return r.messages[r.messages.length - 1];
  };
}

const rowsOf = (title: string) => getSpreadsheet(env.core, env.admin, ids[title], { track: false }).records;

describe("interpretação de pedidos (português)", () => {
  it("reconhece as intenções dos exemplos", () => {
    expect(parse("Abra a planilha de outubro do seu Dinaldo.").intent).toBe("open");
    expect(parse("Quanto esse cliente pagou durante este ano?").intent).toBe("totals");
    expect(parse("Adicione um pagamento de R$ 350 no dia 12.").intent).toBe("add");
    expect(parse("Altere o valor deste pagamento para R$ 400.").intent).toBe("update");
    expect(parse("Crie a planilha de novembro com base na de outubro.").intent).toBe("create");
    expect(parse("Mostre os pagamentos atrasados.").intent).toBe("pending");
    expect(parse("Some todos os pagamentos recebidos neste mês.").intent).toBe("totals");
    expect(parse("Encontre todas as planilhas de um determinado cliente.").intent).toBe("find");
    expect(parse("Mostre os lançamentos do Arlindo").intent).toBe("open");
  });

  it("extrai valores, datas e meses", () => {
    const p = parse("Adicione um pagamento de R$ 1.200,50 no dia 12 de outubro");
    expect(p.amount).toBe(1200.5);
    expect(p.day).toBe(12);
    expect(p.month).toBe(10);
    expect(parse("lance 350 reais").amount).toBe(350);
    expect(parse("Altere o valor para 400").amount).toBe(400);
    const c = parse("Crie a planilha de novembro com base na de outubro");
    expect([c.month, c.baseMonth]).toEqual([11, 10]);
    expect(parse("pagamentos de 12/10/2026").date).toBe("2026-10-12");
  });

  it("encontra o cliente pelo nome, apelido ou com erro de digitação", () => {
    const clients = [{ n: "Dinaldo" }, { n: "Maria Tereza" }, { n: "Maria José (Zeze)" }, { n: "Sr. Osvaldo" }];
    const pick = (t: string) => pickClear(findMentions(t, clients, (c) => [c.n]));
    expect(pick("planilha do seu Dinaldo").clear?.n).toBe("Dinaldo");
    expect(pick("planilha do seu Dinaldu").clear?.n).toBe("Dinaldo");
    expect(pick("da dona Zeze").clear?.n).toBe("Maria José (Zeze)");
    expect(pick("do Osvaldo").clear?.n).toBe("Sr. Osvaldo");
    expect(pick("da Maria").ambiguous.map((c) => c.n).sort()).toEqual(["Maria José (Zeze)", "Maria Tereza"]);
  });
});

describe("assistente (motor próprio)", () => {
  it("abre a planilha certa do cliente", async () => {
    const say = chat();
    const m = await say("Abra a planilha de outubro do seu Arlindo.");
    expect(m.content).toMatch(/Encontrei a planilha \*\*Controle Escala - Outubro\*\*.*2 linha\(s\) de Arlindo/);
    expect(m.actions?.[0]).toMatchObject({ kind: "open_spreadsheet", spreadsheetId: ids["Controle Escala - Outubro"] });
  });

  it("calcula totais com dados reais e explica de onde vieram", async () => {
    const say = chat();
    await say("Abra a planilha de outubro do seu Arlindo");
    const m = await say("Quanto esse cliente pagou durante este ano?");
    expect(m.content).toContain("R$ 8.100,00");
    expect(m.content).toMatch(/Vr PgtoTotal/);
    const s = await say("Some todos os pagamentos recebidos em outubro");
    expect(s.content).toContain("R$ 6.460,00");
  });

  it("não altera nada antes da confirmação e registra a origem 'assistente'", async () => {
    const say = chat();
    await say("Abra a planilha de outubro do seu Arlindo");
    const before = rowsOf("Controle Escala - Outubro").length;
    const m = await say("Adicione um pagamento de R$ 350 no dia 12");
    expect(m.pending?.status).toBe("pending");
    expect(m.pending?.changes).toEqual(
      expect.arrayContaining([
        { label: "Vr PgtoTotal", value: "R$ 350,00" },
        { label: "DATA PGMTO", value: `12/10/${YEAR}` },
      ]),
    );
    expect(rowsOf("Controle Escala - Outubro").length).toBe(before);
    const done = await confirmAction(env.core, env.admin, m.pending!.id);
    expect(done[0].content).toMatch(/Linha adicionada/);
    expect(rowsOf("Controle Escala - Outubro").length).toBe(before + 1);
    const audit = env.core.db.get<{ source: string }>("SELECT source FROM audit_events WHERE action = 'rows.insert' ORDER BY seq DESC LIMIT 1");
    expect(audit?.source).toBe("ai");
    // Confirmar de novo não duplica.
    const again = await confirmAction(env.core, env.admin, m.pending!.id);
    expect(again[0].content).toMatch(/já foi executada/);
  });

  it("altera 'este pagamento' com 'sim' e permite desfazer", async () => {
    const say = chat();
    await say("Abra a planilha de outubro do seu Arlindo");
    const add = await say("Adicione um pagamento de R$ 350 no dia 12");
    await confirmAction(env.core, env.admin, add.pending!.id);
    const upd = await say("Altere o valor deste pagamento para R$ 400");
    expect(upd.pending?.changes?.[0].value).toBe("R$ 350,00 → R$ 400,00");
    const ok = await say("sim");
    expect(ok.content).toMatch(/Alteração salva/);
    const amountId = getSpreadsheet(env.core, env.admin, ids["Controle Escala - Outubro"]).columns.find((c) => c.role === "amount")!.id;
    expect(rowsOf("Controle Escala - Outubro").some((r) => r.data[amountId] === 400)).toBe(true);
    const undoBtn = ok.actions!.find((a) => a.kind === "undo") as { pendingId: string };
    const undo = undoAction(env.core, env.admin, undoBtn.pendingId);
    expect(undo[0].content).toMatch(/Desfeito/);
    expect(rowsOf("Controle Escala - Outubro").some((r) => r.data[amountId] === 350)).toBe(true);
  });

  it("pergunta quando há mais de uma possibilidade", async () => {
    const say = chat();
    const q = await say("Abra a planilha de outubro da Maria");
    expect(q.content).toMatch(/mais de um cliente/);
    const a = await say("2");
    expect(a.content).toMatch(/Maria José \(Zeze\)/);
    const upd = await say("Altere o valor do pagamento do Arlindo em outubro para R$ 999");
    expect(upd.content).toMatch(/Qual deles devo alterar/);
    expect(upd.table?.rows).toHaveLength(2);
    const pick = await say("1");
    expect(pick.pending?.changes?.[0].value).toMatch(/→ R\$ 999,00/);
  });

  it("lista pendências só quando a situação está configurada", async () => {
    const say = chat();
    const m = await say("Mostre os pagamentos atrasados");
    expect(m.content).toMatch(/\*\*2\*\* lançamento\(s\) pendente\(s\), somando R\$ 4\.020,00/);
    expect(m.table?.rows.map((r) => r[1]).sort()).toEqual(["ARLINDO", "MARIA TEREZA"]);
  });

  it("cria a planilha do mês seguinte copiando só as colunas fixas", async () => {
    const say = chat();
    const m = await say("Crie a planilha de novembro com base na de outubro");
    expect(m.pending?.changes?.find((c) => c.label === "Nome")?.value).toBe("Controle Escala - Novembro");
    const done = await confirmAction(env.core, env.admin, m.pending!.id);
    expect(done[0].content).toMatch(/criada/);
    const id = env.core.db.get<{ id: string }>("SELECT id FROM spreadsheets WHERE title = 'Controle Escala - Novembro'")!.id;
    const d = getSpreadsheet(env.core, env.admin, id);
    expect(d.month).toBe(11);
    const amount = d.columns.find((c) => c.role === "amount")!;
    const worker = d.columns.find((c) => c.role === "worker")!;
    expect(d.records.every((r) => r.data[amount.id] === undefined)).toBe(true);
    expect(d.records[0].data[worker.id]).toBe("PAULA SOUZA");
  });

  it("cancelar não altera nada", async () => {
    const say = chat();
    await say("Abra a planilha de outubro do seu Arlindo");
    const m = await say("Adicione um pagamento de R$ 10 no dia 1");
    const before = rowsOf("Controle Escala - Outubro").length;
    cancelAction(env.core, env.admin, m.pending!.id);
    await expect(confirmAction(env.core, env.admin, m.pending!.id)).resolves.toMatchObject([{ content: expect.stringMatching(/não está mais disponível/) }]);
    expect(rowsOf("Controle Escala - Outubro").length).toBe(before);
  });

  it("respeita o perfil do usuário", async () => {
    const viewer = await env.makeUser("viewer");
    const say = chat(viewer);
    await say("Abra a planilha de outubro do seu Arlindo");
    const m = await say("Adicione um pagamento de R$ 350 no dia 12");
    expect(m.pending).toBeUndefined();
    expect(m.content).toMatch(/somente leitura/);
  });

  it("não inventa: diz quando não encontra", async () => {
    const say = chat();
    expect((await say("Abra a planilha de outubro do seu Juvenal")).content).toMatch(/Não encontrei esse cliente/);
    expect((await say("Abra a planilha de março")).content).toMatch(/Não encontrei planilhas de março/);
  });

  it("usa a planilha aberta na tela como contexto", async () => {
    const say = chat();
    const m = await say("qual o total desta planilha?", { spreadsheetId: ids["Controle Escala - Setembro"] });
    expect(m.content).toContain("R$ 7.800,00");
  });
});

describe("assistente com modelo de linguagem (provedor compatível com OpenAI)", () => {
  it("executa ferramentas, mas só propõe alterações e não envia dados sensíveis", async () => {
    const seen: unknown[] = [];
    let step = 0;
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const json = JSON.parse(body);
        seen.push(json);
        step++;
        const reply =
          step === 1
            ? { role: "assistant", content: null, tool_calls: [{ id: "t1", type: "function", function: { name: "get_spreadsheet", arguments: JSON.stringify({ spreadsheetId: ids["Controle Escala - Outubro"] }) } }] }
            : step === 2
              ? {
                  role: "assistant",
                  content: null,
                  tool_calls: [{ id: "t2", type: "function", function: { name: "add_record", arguments: JSON.stringify({ spreadsheetId: ids["Controle Escala - Outubro"], values: { Assistido: "BENEDITA", valor: 123 } }) } }],
                }
              : { role: "assistant", content: "ok" };
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ choices: [{ message: reply }] }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as { port: number }).port;
    env.core.cfg.ai = { mode: "llm", baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: "x", model: "modelo-teste", providerIsLocal: false, timeoutMs: 5000 };
    try {
      const before = rowsOf("Controle Escala - Outubro").length;
      const m = await chat()("lance 123 para a Benedita na planilha de outubro");
      expect(m.engine).toBe("modelo-teste");
      expect(m.pending?.status).toBe("pending");
      expect(rowsOf("Controle Escala - Outubro").length).toBe(before);
      // A resposta da ferramenta enviada ao modelo externo não contém a chave PIX.
      const toolMsg = (seen[1] as { messages: { role: string; content: string }[] }).messages.find((x) => x.role === "tool")!;
      expect(toolMsg.content).not.toMatch(/paula@example\.com|11999990000/);
      expect(toolMsg.content).not.toMatch(/CHAVE PIX/);
      // As ferramentas são enviadas com esquema JSON.
      expect((seen[0] as { tools: { function: { name: string } }[] }).tools.map((t) => t.function.name)).toContain("calculate_totals");
    } finally {
      server.close();
    }
  });

  it("cai para o motor próprio se o provedor falhar", async () => {
    env.core.cfg.ai = { mode: "llm", baseUrl: "http://127.0.0.1:9/v1", apiKey: "", model: "fora-do-ar", providerIsLocal: false, timeoutMs: 2000 };
    const m = await chat()("Mostre os pagamentos pendentes");
    expect(m.engine).toBe("rules");
    expect(m.content).toMatch(/pendente/);
  });
});
