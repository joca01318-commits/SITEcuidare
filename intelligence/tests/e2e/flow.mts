// Teste ponta a ponta no navegador (Chromium), com dados fictícios.
// Uso: com o servidor rodando (ver README), execute:
//   E2E_URL=http://127.0.0.1:8787 E2E_CODE=<código admin> E2E_FILE=<xlsx de teste> E2E_OUT=<pasta> npx tsx tests/e2e/flow.mts
import { chromium, type Page } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.E2E_URL ?? "http://127.0.0.1:8787";
const CODE = process.env.E2E_CODE ?? "";
const FILE = process.env.E2E_FILE ?? "";
const OUT = process.env.E2E_OUT ?? "./test-results";
const EXE = process.env.CHROMIUM ?? "/opt/pw-browsers/chromium";
fs.mkdirSync(OUT, { recursive: true });

const results: { step: string; ok: boolean; detail?: string }[] = [];
async function step(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ step: name, ok: true });
    console.log(`✓ ${name}`);
  } catch (e) {
    results.push({ step: name, ok: false, detail: (e as Error).message.split("\n")[0] });
    await page.screenshot({ path: path.join(OUT, `falha-${results.length}.png`) }).catch(() => {});
    console.log(`✗ ${name}: ${(e as Error).message.split("\n")[0]}`);
  }
}
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });

const browser = await chromium.launch({ executablePath: EXE, args: ["--no-proxy-server"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "pt-BR", acceptDownloads: true });
ctx.setDefaultTimeout(12_000);
const page = await ctx.newPage();
const consoleErrors: string[] = [];
page.on("console", (m) => m.type() === "error" && !/status of 401/.test(m.text()) && consoleErrors.push(m.text()));
page.on("pageerror", (e) => consoleErrors.push(e.message));

const email = `admin.${Date.now()}@teste.com`;
const password = "uma-senha-bem-forte-123";

await step("1. Entrar com código de acesso e criar conta", async () => {
  await page.goto(BASE + "/");
  await page.waitForURL("**/entrar");
  await shot(page, "01-codigo");
  await page.getByLabel("Código de acesso").fill(CODE);
  await page.getByRole("button", { name: /Continuar/ }).click();
  await page.getByLabel("Nome").fill("Ana Teste");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel(/^Senha/).fill(password);
  await page.getByLabel("Confirme a senha").fill(password);
  await shot(page, "02-cadastro");
  await page.getByRole("button", { name: /Criar acesso/ }).click();
  await page.getByText(/Bom dia|Boa tarde|Boa noite/).waitFor();
});

await step("2. Cadastrar um cliente", async () => {
  await page.getByRole("button", { name: "Cadastrar cliente" }).click();
  await page.getByLabel("Nome do cliente (assistido)").fill("Cliente Avulso Teste");
  await page.getByRole("button", { name: "Salvar" }).click();
  await page.waitForURL("**/clientes/**");
  await page.getByRole("heading", { name: "Cliente Avulso Teste" }).waitFor();
});

await step("3. Importar planilha (Excel)", async () => {
  await page.goto(BASE + "/planilhas");
  await page.getByRole("button", { name: "Importar" }).first().click();
  await page.locator('input[type="file"]').setInputFiles(FILE);
  await page.getByText(/Importar “/).waitFor();
  await shot(page, "03-importacao-revisao");
  await page.getByRole("button", { name: /Importar \d+ planilha/ }).click();
  await page.getByText("Controle Escala - Outubro").first().waitFor();
  await shot(page, "04-lista-planilhas");
});

await step("4. Abrir a planilha de um cliente pela assistente", async () => {
  await page.goto(BASE + "/");
  await page.getByLabel("Pergunta para a assistente").fill("Abra a planilha de outubro do seu Arlindo");
  await page.getByRole("button", { name: "Perguntar", exact: true }).click();
  await page.getByText(/Encontrei a planilha/).waitFor();
  await shot(page, "05-assistente-abrir");
  await page.getByRole("button", { name: "Abrir planilha" }).click();
  await page.waitForURL("**/planilhas/**cliente=**");
  await page.getByText(/Só as linhas de Arlindo/).waitFor();
  await shot(page, "06-planilha-filtrada");
});

await step("5. Consultar um total mensal", async () => {
  await page.getByLabel("Mensagem para a assistente").fill("Some todos os pagamentos recebidos em outubro");
  await page.keyboard.press("Enter");
  await page.getByText(/R\$\s6\.460,00/).first().waitFor();
});

let sheetUrl = "";
await step("6. Adicionar um pagamento (com confirmação)", async () => {
  await page.getByLabel("Mensagem para a assistente").fill("Adicione um pagamento de R$ 350 no dia 12 para o Arlindo");
  await page.keyboard.press("Enter");
  await page.locator(".pending-card").last().waitFor();
  await shot(page, "07-confirmacao");
  await page.locator(".pending-card").last().getByRole("button", { name: "Confirmar" }).click();
  await page.getByText(/Linha adicionada/).waitFor();
  sheetUrl = page.url();
});

await step("7. Totais atualizados após a alteração", async () => {
  await page.getByRole("button", { name: "Fechar assistente" }).click();
  await page.waitForTimeout(600);
  const foot = (await page.locator(".g-foot").innerText()).replace(/\s+/g, " ");
  if (!foot.includes("R$ 5.570,00")) throw new Error(`rodapé: ${foot.replace(/\s+/g, " ")}`);
  await shot(page, "08-grade-totais");
});

await step("8. Editar célula na grade e salvar", async () => {
  await page.goto(sheetUrl.split("?")[0]);
  await page.locator(".g-row").first().waitFor();
  const cell = page.locator(".g-row").first().locator(".g-cell").nth(8); // Obs Cobertura
  await cell.dblclick();
  await page.keyboard.type("Observação de teste");
  await page.keyboard.press("Enter");
  await page.getByText(/Salvo|Tudo salvo/).waitFor();
  await page.waitForTimeout(800);
});

await step("9. Dados permanecem após recarregar", async () => {
  await page.reload();
  await page.getByText("Observação de teste").waitFor();
});

await step("10. Criar planilha baseada em outra", async () => {
  await page.getByRole("button", { name: "Fechar assistente" }).click().catch(() => {});
  await page.getByRole("button", { name: "Abrir assistente" }).click();
  await page.getByLabel("Mensagem para a assistente").fill("Crie a planilha de novembro com base na de outubro");
  await page.keyboard.press("Enter");
  await page.locator(".pending-card").last().getByRole("button", { name: "Confirmar" }).click();
  await page.getByText(/Planilha "Controle Escala - Novembro" criada/).waitFor();
  await page.getByRole("button", { name: "Fechar assistente" }).click();
});

await step("11. Exportar Excel e PDF", async () => {
  await page.goto(sheetUrl.split("?")[0]);
  await page.locator(".g-row").first().waitFor();
  for (const [label, ext] of [
    ["Excel (.xlsx)", ".xlsx"],
    ["PDF para imprimir", ".pdf"],
  ] as const) {
    await page.getByRole("button", { name: "Exportar" }).click();
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: label }).click()]);
    const p = path.join(OUT, `export${ext}`);
    await dl.saveAs(p);
    const head = fs.readFileSync(p).subarray(0, 4).toString();
    if (ext === ".pdf" && head !== "%PDF") throw new Error("PDF inválido");
    if (ext === ".xlsx" && !head.startsWith("PK")) throw new Error("XLSX inválido");
  }
});

await step("12. Consultar o histórico", async () => {
  await page.getByRole("button", { name: "Mais ações" }).click();
  await page.getByRole("menuitem", { name: "Histórico de alterações" }).click();
  await page.getByText(/Observação de teste|alterado em/).first().waitFor();
  await shot(page, "09-historico");
  await page.getByRole("button", { name: "Fechar" }).click();
});

await step("13. Restaurar uma versão anterior", async () => {
  await page.getByRole("button", { name: "Mais ações" }).click();
  await page.getByRole("menuitem", { name: "Versões salvas" }).click();
  await page.getByRole("button", { name: "Restaurar" }).last().click();
  await page.getByRole("button", { name: "Restaurar" }).last().click();
  await page.getByText(/Versão \d+ restaurada/).waitFor();
  await page.getByRole("button", { name: "Fechar" }).click();
  await page.waitForTimeout(800);
  if (await page.getByText("Observação de teste").count()) throw new Error("a observação deveria ter sumido após restaurar a versão da importação");
});

await step("14. Bloquear acesso sem login e sem permissão", async () => {
  const anon = await browser.newContext();
  const r = await anon.request.get(BASE + "/api/spreadsheets");
  if (r.status() !== 401) throw new Error(`anônimo recebeu ${r.status()}`);
  const p2 = await anon.newPage();
  await p2.goto(sheetUrl);
  await p2.waitForURL("**/entrar");
  // Usuário de leitura não pode alterar.
  const inv = await page.request.post(BASE + "/api/admin/invites", { headers: { "X-Cuidare": "1" }, data: { label: "Leitura", role: "viewer", scopeAll: true, maxUses: 1 } });
  const { code } = await inv.json();
  await anon.request.post(BASE + "/api/auth/gate", { headers: { "X-Cuidare": "1" }, data: { code } });
  await anon.request.post(BASE + "/api/auth/register", { headers: { "X-Cuidare": "1" }, data: { name: "Leitor", email: `leitor.${Date.now()}@teste.com`, password: "outra-senha-forte-42" } });
  const sid = sheetUrl.split("/planilhas/")[1].split("?")[0];
  const detail = await (await anon.request.get(`${BASE}/api/spreadsheets/${sid}`)).json();
  const rec = detail.records[0];
  const w = await anon.request.post(`${BASE}/api/spreadsheets/${sid}/cells`, { headers: { "X-Cuidare": "1" }, data: { ops: [{ recordId: rec.id, columnId: "c8", value: "x", expected: rec.data.c8 ?? null }] } });
  if (w.status() !== 403) throw new Error(`leitor conseguiu escrever (${w.status()})`);
  const pix = detail.records.find((x: { data: Record<string, unknown> }) => x.data.c12)?.data.c12;
  if (pix && !String(pix).startsWith("••••")) throw new Error("PIX visível para leitura");
  const csrf = await page.request.post(`${BASE}/api/spreadsheets/${sid}/cells`, { data: { ops: [] } });
  if (csrf.status() !== 403) throw new Error(`sem cabeçalho anti-CSRF recebeu ${csrf.status()}`);
  await anon.close();
});

await step("15. Celular: painel, planilha e assistente", async () => {
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "pt-BR" });
  await m.addCookies((await ctx.cookies()).map((c) => ({ ...c })));
  const mp = await m.newPage();
  await mp.goto(BASE + "/");
  await mp.getByText(/Bom dia|Boa tarde|Boa noite/).waitFor();
  await mp.screenshot({ path: path.join(OUT, "10-celular-inicio.png") });
  await mp.goto(sheetUrl.split("?")[0]);
  await mp.locator(".row-card").first().waitFor();
  await mp.screenshot({ path: path.join(OUT, "11-celular-planilha.png") });
  await mp.locator(".row-card").first().click();
  await mp.locator(".bottom-sheet").waitFor();
  await mp.screenshot({ path: path.join(OUT, "12-celular-editar.png") });
  await mp.getByRole("button", { name: "Cancelar" }).click();
  await mp.goto(BASE + "/assistente");
  await mp.getByLabel("Mensagem para a assistente").fill("Mostre os pagamentos pendentes");
  await mp.keyboard.press("Enter");
  await mp.getByText(/pendente/).first().waitFor();
  await mp.waitForTimeout(400);
  await mp.screenshot({ path: path.join(OUT, "13-celular-assistente.png") });
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (overflow) throw new Error("rolagem horizontal na página do celular");
  await m.close();
});

await step("16. Telas principais (capturas)", async () => {
  await page.goto(BASE + "/");
  await page.getByText(/Abertas recentemente/).waitFor();
  await page.waitForTimeout(300);
  await shot(page, "14-inicio");
  await page.goto(BASE + "/clientes");
  await page.locator("tbody tr").first().waitFor();
  await shot(page, "15-clientes");
  await page.goto(BASE + "/admin");
  await page.getByRole("heading", { name: "Códigos de acesso" }).waitFor();
  await shot(page, "16-admin");
});

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} etapas ok`);
if (consoleErrors.length) console.log("Erros no console do navegador:", consoleErrors.slice(0, 10));
process.exit(failed.length ? 1 : 0);
