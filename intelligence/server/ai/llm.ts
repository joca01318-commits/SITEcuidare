// Provedor de modelo de linguagem compatível com a API de chat da OpenAI.
// Funciona com Ollama (modelo local, gratuito), Groq e outros. Trocar de provedor
// é só mudar AI_BASE_URL/AI_MODEL no .env — o resto do sistema não muda.

import type { AssistantAction } from "../../shared/types.js";
import { MONTHS_PT } from "../../shared/types.js";
import type { Config } from "../config.js";
import { AppError } from "../lib/util.js";
import {
  calculateTotals,
  changeHistory,
  exportLink,
  getSpreadsheetTool,
  prepareAddRecord,
  prepareCreateSpreadsheet,
  prepareDeleteRecord,
  prepareRestoreVersion,
  prepareUpdateRecord,
  queryRecords,
  savePending,
  searchClients,
  searchSpreadsheets,
  TOOL_SCHEMAS,
  toolJsonSchemas,
  type Prepared,
  type ToolCtx,
  type ToolName,
} from "./tools.js";
import { listVersions } from "../domain/spreadsheets.js";
import type { ConvState, PageContext, Reply } from "./rules.js";

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

export function llmConfigured(cfg: Config): boolean {
  return !!(cfg.ai.baseUrl && cfg.ai.model);
}

async function callModel(cfg: Config, messages: ChatMessage[]): Promise<ChatMessage> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.ai.timeoutMs);
  try {
    const res = await fetch(`${cfg.ai.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(cfg.ai.apiKey ? { Authorization: `Bearer ${cfg.ai.apiKey}` } : {}) },
      body: JSON.stringify({ model: cfg.ai.model, messages, tools: toolJsonSchemas(), tool_choice: "auto", temperature: 0.1 }),
      signal: controller.signal,
    });
    if (res.status === 429) throw new AppError(503, "ai_rate_limited", "O limite gratuito do provedor de IA foi atingido.");
    if (!res.ok) throw new AppError(502, "ai_error", `O provedor de IA respondeu com erro ${res.status}.`);
    const body = (await res.json()) as { choices?: { message?: ChatMessage }[] };
    const msg = body.choices?.[0]?.message;
    if (!msg) throw new AppError(502, "ai_error", "Resposta vazia do provedor de IA.");
    return msg;
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new AppError(504, "ai_timeout", "O modelo de IA demorou demais para responder.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function systemPrompt(ctx: ToolCtx, page: PageContext, pageTitle: string | null): string {
  const now = new Date();
  return [
    "Você é a assistente da Cuidare Intelligence, sistema interno da Cuidare (empresa de cuidadores de idosos em São Paulo).",
    "Responda sempre em português do Brasil, de forma curta, clara e educada.",
    `Hoje é ${now.toLocaleDateString("pt-BR")} (mês ${now.getMonth() + 1} = ${MONTHS_PT[now.getMonth()]}, ano ${now.getFullYear()}).`,
    `Usuário: ${ctx.actor.name} (perfil ${ctx.actor.role}).`,
    pageTitle ? `O usuário está com a planilha "${pageTitle}" aberta (id ${page.spreadsheetId}). "Esta planilha" se refere a ela.` : "",
    page.clientId ? `A tela atual é do cliente de id ${page.clientId}.` : "",
    "Regras obrigatórias:",
    "- Use SOMENTE as ferramentas para obter dados. Nunca invente clientes, valores, planilhas ou datas.",
    "- Totais e somas: use calculate_totals. Nunca faça contas de cabeça.",
    "- Para alterar dados, use add_record/update_record/delete_record/create_spreadsheet/restore_previous_version. Elas apenas PROPÕEM a alteração; o usuário confirma na tela. Nunca diga que algo foi salvo antes da confirmação.",
    "- Se houver mais de um cliente, planilha ou linha possível, pergunte qual é a correta antes de propor alterações.",
    "- Se não encontrar a informação, diga isso claramente.",
    "- Clientes são os assistidos (ex.: “seu Dinaldo” é o cliente Dinaldo). Primeiro use search_clients para obter o id.",
    "- Não altere permissões nem apague históricos (não existem ferramentas para isso).",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Executa o ciclo modelo → ferramentas → modelo, com limite de passos. */
export async function respondWithLlm(
  ctx: ToolCtx,
  cfg: Config,
  text: string,
  history: { role: "user" | "assistant"; content: string }[],
  state: ConvState,
  page: PageContext,
): Promise<Reply> {
  const pageTitle = page.spreadsheetId
    ? ctx.core.db.get<{ title: string }>("SELECT title FROM spreadsheets WHERE id = ? AND org_id = ?", [page.spreadsheetId, ctx.actor.orgId])?.title ?? null
    : null;
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(ctx, page, pageTitle) },
    ...history.slice(-10).map((h) => ({ role: h.role, content: h.content.slice(0, 2000) }) as ChatMessage),
    { role: "user", content: text },
  ];
  const actions: AssistantAction[] = [];
  let newState: ConvState = { ...state, choice: null, awaiting: null };

  for (let step = 0; step < 6; step++) {
    const msg = await callModel(cfg, messages);
    const calls = msg.tool_calls ?? [];
    if (!calls.length) {
      return { content: (msg.content ?? "").trim() || "Não consegui formular uma resposta.", actions: dedupe(actions), state: newState, handled: true };
    }
    messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: calls });
    for (const call of calls) {
      const name = call.function.name as ToolName;
      let output: unknown;
      try {
        const schema = TOOL_SCHEMAS[name];
        if (!schema) throw new AppError(400, "unknown_tool", `Ferramenta desconhecida: ${name}`);
        const args = schema.parse(JSON.parse(call.function.arguments || "{}")) as Record<string, never>;
        const result = runTool(ctx, name, args, actions);
        if (result && typeof result === "object" && "__prepared" in result) {
          const prepared = (result as { __prepared: Prepared }).__prepared;
          const id = savePending(ctx, prepared);
          newState = { ...newState, pendingId: id };
          return {
            content: [`${prepared.summary}.`, ...prepared.warnings.map((w) => `⚠️ ${w}`), "Confirma?"].join("\n"),
            pending: { id, status: "pending", summary: prepared.summary, changes: prepared.changes },
            actions: [{ kind: "confirm", pendingId: id, label: "Confirmar" }, { kind: "cancel", pendingId: id, label: "Cancelar" }, ...dedupe(actions)],
            state: newState,
            handled: true,
          };
        }
        output = result;
        if (name === "get_spreadsheet") newState.spreadsheetId = (args as unknown as { spreadsheetId: string }).spreadsheetId;
      } catch (e) {
        output = { erro: e instanceof AppError ? e.message : e instanceof Error && e.name === "ZodError" ? "Parâmetros inválidos." : "Falha ao executar." };
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(output).slice(0, 12_000) });
    }
  }
  return { content: "Precisei de passos demais para responder. Tente um pedido mais específico.", actions: dedupe(actions), state: newState, handled: true };
}

function dedupe(actions: AssistantAction[]): AssistantAction[] {
  const seen = new Set<string>();
  return actions.filter((a) => {
    const k = JSON.stringify(a);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 6);
}

function runTool(ctx: ToolCtx, name: ToolName, a: Record<string, never>, actions: AssistantAction[]): unknown {
  const args = a as Record<string, unknown>;
  switch (name) {
    case "search_clients":
      return searchClients(ctx, args as { query: string });
    case "search_spreadsheets": {
      const r = searchSpreadsheets(ctx, args as never);
      for (const s of r.slice(0, 3)) actions.push({ kind: "open_spreadsheet", spreadsheetId: s.id, clientId: (args.clientId as string) ?? null, label: `Abrir ${s.title}` });
      return r;
    }
    case "get_spreadsheet": {
      const r = getSpreadsheetTool(ctx, args as never);
      actions.push({ kind: "open_spreadsheet", spreadsheetId: r.id, clientId: (args.clientId as string) ?? null, label: `Abrir ${r.titulo}` });
      return r;
    }
    case "query_records":
      return queryRecords(ctx, args as never);
    case "calculate_totals": {
      const r = calculateTotals(ctx, args as never);
      return {
        total: r.total,
        lancamentos: r.count,
        por_planilha: r.perSheet.map((p) => ({ planilha: p.sheet.title, periodo: p.sheet.period, coluna: p.column, total: p.total, lancamentos: p.count })),
        planilhas_sem_coluna_de_valor: r.sheetsWithoutAmount,
        planilhas_sem_coluna_de_situacao: r.sheetsWithoutStatus,
        grupos: r.groups,
      };
    }
    case "export_spreadsheet": {
      const r = exportLink(ctx, args as never);
      actions.push({ kind: "download", url: r.url, label: `Baixar ${args.format === "pdf" ? "PDF" : "Excel"}` });
      return { ok: true, mensagem: "Link de download exibido para o usuário." };
    }
    case "get_change_history":
      return changeHistory(ctx, args as never);
    case "create_spreadsheet":
      return { __prepared: prepareCreateSpreadsheet(ctx, { ...(args as unknown as { month: number; year: number }), templateId: args.templateSpreadsheetId as string | undefined }) };
    case "add_record":
      return { __prepared: prepareAddRecord(ctx, args as never) };
    case "update_record":
      return { __prepared: prepareUpdateRecord(ctx, args as never) };
    case "delete_record":
      return { __prepared: prepareDeleteRecord(ctx, args as never) };
    case "restore_previous_version": {
      if (!args.versionNumber)
        return listVersions(ctx.core, ctx.actor, String(args.spreadsheetId))
          .slice(0, 10)
          .map((v) => ({ versao: v.number, quando: v.createdAt, motivo: v.reason, linhas: v.rowCount }));
      return { __prepared: prepareRestoreVersion(ctx, args as never) };
    }
  }
}
