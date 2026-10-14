// Interpretação de pedidos em português do Brasil, sem modelo de linguagem.
// Extrai intenção, cliente, mês/ano, datas e valores com regras determinísticas.

import { MONTHS_PT } from "../../shared/types.js";
import { makeIsoDate, nameKey, normalize, parseNumberBR, wordsMatch } from "../../shared/text.js";

export type Intent =
  | "help"
  | "thanks"
  | "undo"
  | "history"
  | "restore"
  | "export"
  | "create"
  | "delete"
  | "update"
  | "add"
  | "pending"
  | "totals"
  | "find"
  | "open"
  | "clients"
  | "choose"
  | "confirm"
  | "cancel"
  | "unknown";

export interface Parsed {
  text: string;
  low: string;
  norm: string;
  tokens: string[];
  intent: Intent;
  month: number | null;
  year: number | null;
  /** Segundo mês citado ("novembro com base em outubro" → base = 10). */
  baseMonth: number | null;
  baseYear: number | null;
  day: number | null;
  date: string | null;
  amount: number | null;
  refersToContextClient: boolean;
  refersToContextSheet: boolean;
  refersToContextRecord: boolean;
  wantsPaid: boolean;
  wantsPending: boolean;
  format: "pdf" | "xlsx" | null;
  choiceIndex: number | null;
  versionNumber: number | null;
  wholeYear: boolean;
  allSheets: boolean;
}

const MONTH_KEYS = MONTHS_PT.map((m) => normalize(m));
const MONTH_ABBR = MONTH_KEYS.map((m) => m.slice(0, 3));

function lowNoAccents(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const has = (norm: string, re: RegExp) => re.test(norm);

export function detectIntent(norm: string, hasAmount: boolean): Intent {
  if (/^(sim|confirmo|confirmar|pode|pode sim|ok|isso|isso mesmo|manda|manda ver|beleza|fechado|positivo|confirma)$/.test(norm)) return "confirm";
  if (/^(nao|cancela|cancelar|deixa|deixa pra la|esquece|negativo|para)$/.test(norm)) return "cancel";
  if (/^(o |a |opcao |numero |n )?(\d{1,2}|primeir[oa]|segund[oa]|terceir[oa]|quart[oa]|quint[oa]|ultim[oa])$/.test(norm)) return "choose";
  if (/^(oi|ola|bom dia|boa tarde|boa noite|e ai|opa|hey|salve)\b/.test(norm) && norm.split(" ").length <= 4) return "help";
  if (/\b(ajuda|o que (voce|vc) (faz|sabe|pode)|como (funciona|usar|uso)|comandos|exemplos)\b/.test(norm)) return "help";
  if (/^(obrigad[oa]|valeu|vlw|brigad[oa]|show|perfeito|otimo)\b/.test(norm)) return "thanks";
  if (has(norm, /\b(desfaz\w*|desfac\w*|reverte\w*|volt\w* (como|ao que) estava|anula\w* (a )?(ultima|alteracao))\b/)) return "undo";
  if (has(norm, /\b(restaur\w*|versao|versoes|voltar (para|a) versao)\b/)) return "restore";
  if (has(norm, /\b(historico|quem (alterou|mudou|editou|mexeu)|o que (mudou|foi alterado|alteraram)|alteracoes|ultimas mudancas|log)\b/)) return "history";
  if (has(norm, /\b(export\w*|baix\w*|download|pdf|xlsx|imprim\w*)\b/) || /\bem excel\b/.test(norm)) return "export";
  if (has(norm, /\b(cri\w*|ger[ae]\w*|nova|novo|mont\w*|fac[ae]|faz)\b/) && has(norm, /\bplanilha/)) return "create";
  if (has(norm, /\bplanilha\b.*\b(com base|baseada|igual|a partir|copiando|modelo)\b/)) return "create";
  if (has(norm, /\b(apag\w*|exclu\w*|remov\w*|delet\w*)\b/)) return "delete";
  if (has(norm, /\b(alter[ae]r?|altere|alterem|mud[ae]r?|mude|corrij[ae]|corrigir|corrige|troqu?e|troca|trocar|atualiz[ae]r?|atualize|edit[ae]r?|edite|ajust[ae]r?|ajuste|substitu[ai]r?|substitua|pass[ae] (o valor|para))\b/)) return "update";
  if (has(norm, /\b(adicion[ae]r?|adicione|lanc[ae]r?|lance|registr[ae]r?|registre|inclu[ai]r?|inclua|insir[ae]|insere|inserir|acrescent[ae]r?|acrescente|anot[ae]r?|anote|coloc[ae]r?|coloque|bot[ae]|botar)\b/)) return "add";
  if (has(norm, /\b(pendente\w*|atrasad\w*|em aberto|nao pag\w*|a pagar|falta pagar|faltam pagar|devendo|inadimpl\w*|vencid\w*)\b/)) return "pending";
  if (has(norm, /\b(quanto|quantos|total|totais|soma|some|somar|somatorio|somando|valor total|fechamento|resumo)\b/)) return "totals";
  if (has(norm, /\b(cliente|clientes|assistido|assistidos)\b/) && has(norm, /\b(quais|lista\w*|todos|cadastrad\w*|quantos)\b/) && !has(norm, /\bplanilha/)) return "clients";
  if (has(norm, /\b(encontr\w*|ach\w*|procur\w*|busc\w*|list\w*|quais|onde)\b/)) return "find";
  if (has(norm, /\b(abr\w*|mostr\w*|ver|veja|exib\w*|acess\w*|traz\w*|traga|quero ver)\b/) || has(norm, /\bplanilha\b/)) return "open";
  if (hasAmount) return "add";
  return "unknown";
}

function findMonths(norm: string): { month: number; index: number }[] {
  const out: { month: number; index: number }[] = [];
  const words = norm.split(" ");
  words.forEach((w, i) => {
    let m = MONTH_KEYS.indexOf(w);
    if (m < 0 && w.length === 3 && i > 0 && /^(de|em|do|no|ate|mes)$/.test(words[i - 1])) m = MONTH_ABBR.indexOf(w);
    if (m >= 0) out.push({ month: m + 1, index: i });
  });
  return out;
}

export function parse(text: string, now = new Date()): Parsed {
  const low = lowNoAccents(text.trim());
  const norm = normalize(text);
  const tokens = norm.split(" ").filter(Boolean);
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;

  // ---- valores em dinheiro (antes de normalizar, para manter vírgulas e pontos)
  let amount: number | null = null;
  const money =
    low.match(/r\$\s*(\d[\d.]*(?:,\d{1,2})?|\d+(?:\.\d{1,2})?)/) ??
    low.match(/(\d[\d.]*(?:,\d{1,2})?)\s*(?:reais|real|conto|pila)\b/) ??
    low.match(/\b(?:valor|pagamento|pagto|pgto|quantia)\s+(?:de\s+|para\s+|pra\s+)?(\d[\d.]*(?:,\d{1,2})?)\b(?!\s*(?:\/|de\s+(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)))/) ??
    low.match(/\b(?:para|pra|por)\s+(\d[\d.]*(?:,\d{1,2})?)\b(?!\s*(?:\/|de\s+(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)|h\b|horas?))/);
  if (money) amount = parseNumberBR(money[1]);

  // ---- datas
  let day: number | null = null;
  let month: number | null = null;
  let year: number | null = null;
  let date: string | null = null;
  const dm = low.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (dm) {
    day = Number(dm[1]);
    month = Number(dm[2]);
    if (dm[3]) year = Number(dm[3]) < 100 ? 2000 + Number(dm[3]) : Number(dm[3]);
  }
  const dayWord = norm.match(/\bdia (\d{1,2})\b/);
  if (!day && dayWord) day = Number(dayWord[1]);
  if (/\bhoje\b/.test(norm)) {
    day = now.getDate();
    month = curMonth;
    year = curYear;
  } else if (/\bontem\b/.test(norm)) {
    const d = new Date(now.getTime() - 86_400_000);
    day = d.getDate();
    month = d.getMonth() + 1;
    year = d.getFullYear();
  }

  // ---- meses e anos
  const months = findMonths(norm);
  let baseMonth: number | null = null;
  let baseYear: number | null = null;
  if (months.length) {
    // "novembro com base na de outubro": o primeiro é o alvo; o citado após "base/partir/igual" é o modelo.
    const baseIdx = tokens.findIndex((t) => /^(base|baseada|baseado|partir|igual|copiando|modelo|copia)$/.test(t));
    const target = months.find((m) => baseIdx < 0 || m.index < baseIdx) ?? months[0];
    const base = baseIdx >= 0 ? months.find((m) => m.index > baseIdx) : months.length > 1 ? months[1] : undefined;
    if (!month || !dm) month = target.month;
    if (base && base !== target) baseMonth = base.month;
  }
  if (/\b(mes passado|ultimo mes|mes anterior)\b/.test(norm)) {
    month = curMonth === 1 ? 12 : curMonth - 1;
    year = curMonth === 1 ? curYear - 1 : curYear;
  } else if (/\b(este mes|esse mes|neste mes|nesse mes|deste mes|desse mes|mes atual|do mes|no mes)\b/.test(norm) && !month) {
    month = curMonth;
    year = year ?? curYear;
  } else if (/\b(proximo mes|mes que vem|mes seguinte)\b/.test(norm)) {
    month = curMonth === 12 ? 1 : curMonth + 1;
    year = curMonth === 12 ? curYear + 1 : curYear;
  }
  const years = [...norm.matchAll(/\b(20\d{2})\b/g)].map((m) => Number(m[1]));
  if (years.length && !(dm && dm[3])) year = years[0];
  if (years.length > 1) baseYear = years[1];
  let wholeYear = false;
  if (/\b(este ano|esse ano|neste ano|nesse ano|deste ano|desse ano|ano atual|no ano|durante o ano)\b/.test(norm)) {
    year = year ?? curYear;
    wholeYear = !months.length;
  } else if (/\b(ano passado|ultimo ano)\b/.test(norm)) {
    year = curYear - 1;
    wholeYear = !months.length;
  } else if (years.length && !months.length && !dm) wholeYear = true;

  if (day && !month && /\bdia\b/.test(norm)) month = null; // mês vem do contexto
  if (day && month) date = makeIsoDate(year ?? curYear, month, day);

  // Números soltos que são o dia não podem virar valor.
  if (amount !== null && day !== null && amount === day && !/r\$|reais|real/.test(low) && !/\b(valor|pagamento) (de |para )?\d/.test(low)) amount = null;

  const amountSeen = amount !== null;
  const intent = detectIntent(norm, amountSeen);

  let choiceIndex: number | null = null;
  if (intent === "choose") {
    const ord: Record<string, number> = { primeiro: 1, primeira: 1, segundo: 2, segunda: 2, terceiro: 3, terceira: 3, quarto: 4, quarta: 4, quinto: 5, quinta: 5, ultimo: -1, ultima: -1 };
    const t = tokens[tokens.length - 1];
    choiceIndex = /^\d+$/.test(t) ? Number(t) : ord[t] ?? null;
  }

  const versionMatch = norm.match(/\bversao (\d{1,4})\b/);

  return {
    text,
    low,
    norm,
    tokens,
    intent,
    month,
    year,
    baseMonth,
    baseYear,
    day,
    date,
    amount,
    refersToContextClient: /\b(esse|este|desse|deste|nesse|neste|mesmo|do) (cliente|assistido|senhor|paciente)\b|\b(dele|dela)\b/.test(norm),
    refersToContextSheet: /\b(esta|essa|nesta|nessa|desta|dessa|mesma) planilha\b|\baqui\b/.test(norm),
    refersToContextRecord: /\b(deste|desse|este|esse|nesse|neste|ultimo|mesmo) (pagamento|lancamento|registro|linha|valor)\b|\b(esse|este) (ai|aqui)\b/.test(norm),
    wantsPaid: /\b(pag[oa]s?|pagou|pagaram|pagamos|recebid[oa]s?|recebemos|recebeu|quitad[oa]s?)\b/.test(norm) && !/\bnao pag/.test(norm),
    wantsPending: /\b(pendente\w*|atrasad\w*|em aberto|nao pag\w*|a pagar|devendo)\b/.test(norm),
    format: /\bpdf\b/.test(norm) ? "pdf" : /\b(excel|xlsx|planilha excel)\b/.test(norm) ? "xlsx" : null,
    choiceIndex,
    versionNumber: versionMatch ? Number(versionMatch[1]) : null,
    wholeYear,
    allSheets: /\b(todas|todos)\b/.test(norm),
  };
}

// ------------------------------------------------------------------ menção de pessoas

/** Palavras do pedido que nunca devem ser confundidas com nomes de clientes. */
const COMMAND_WORDS = new Set(
  (
    "abra abre abrir abrindo mostre mostrar mostra ver veja exiba exibir acessar acesse planilha planilhas mes meses ano anos dia dias de da do das dos " +
    "no na nos nas em um uma uns umas o a os as e ou para pra por com sem que qual quais quanto quantos quanta total soma some somar " +
    "pagamento pagamentos pago paga pagos pagas pagou pagaram valor valores reais real cliente clientes assistido assistidos senhor senhora seu sua dona sr sra " +
    "adicione adicionar adiciona lance lancar lanca registre registrar inclua incluir insira inserir coloque colocar altere alterar mude mudar " +
    "corrija corrigir troque trocar atualize atualizar apague apagar exclua excluir remova remover crie criar gere gerar nova novo base baseada " +
    "partir igual modelo copia copiando todos todas encontre encontrar ache achar procure procurar busque buscar liste listar pendente pendentes " +
    "atrasado atrasados atrasada atrasadas aberto aberta desfaca desfazer historico versao exportar exporte baixar baixe pdf excel este esse esta essa " +
    "neste nesse nesta nessa deste desse desta dessa durante ate hoje ontem recebido recebidos recebidas quero preciso favor porfavor por favor me minha meu " +
    "linha linhas registro registros lancamento lancamentos tem ha existe foi sao eh e esta estao cuidador cuidadora cuidadores plantao plantoes " +
    "janeiro fevereiro marco abril maio junho julho agosto setembro outubro novembro dezembro passado atual proximo vem anterior ultimo ultima " +
    "situacao status data datas obs observacao quem alterou mudou o que fez fiz"
  ).split(" "),
);

export interface PersonCandidate<T> {
  item: T;
  score: number;
}

/**
 * Encontra quais nomes (clientes ou cuidadores) aparecem no texto.
 * Cada palavra do nome vale mais quanto mais rara ela for entre todos os nomes.
 */
export function findMentions<T>(text: string, items: T[], labelsOf: (t: T) => string[]): PersonCandidate<T>[] {
  const words = nameKey(text)
    .split(" ")
    .filter((w) => w.length >= 3 && !COMMAND_WORDS.has(w) && !/^\d+$/.test(w));
  if (!words.length) return [];
  // Frequência de cada palavra entre os nomes (para pesar nomes comuns como "Maria").
  const freq = new Map<string, number>();
  const tokenized = items.map((it) =>
    labelsOf(it).map((l) =>
      nameKey(l)
        .split(" ")
        .filter((w) => w.length >= 2 && !["de", "da", "do", "das", "dos"].includes(w)),
    ),
  );
  for (const labels of tokenized) for (const t of new Set(labels.flat())) freq.set(t, (freq.get(t) ?? 0) + 1);
  const out: PersonCandidate<T>[] = [];
  tokenized.forEach((labels, i) => {
    let best = 0;
    for (const nameTokens of labels) {
      if (!nameTokens.length) continue;
      let matchedWeight = 0;
      let totalWeight = 0;
      let matchedCount = 0;
      for (const nt of nameTokens) {
        const w = 1 / Math.sqrt(freq.get(nt) ?? 1);
        totalWeight += w;
        const hit = words.some((x) => x === nt || (nt.length >= 4 && wordsMatch(x, nt)));
        if (hit) {
          matchedWeight += w;
          matchedCount++;
        }
      }
      if (!matchedCount) continue;
      const score = matchedWeight / totalWeight + (matchedCount === nameTokens.length ? 0.25 : 0);
      best = Math.max(best, score);
    }
    if (best > 0) out.push({ item: items[i], score: Math.round(best * 1000) / 1000 });
  });
  return out.sort((a, b) => b.score - a.score);
}

/** Decide se o melhor candidato é claramente o certo ou se é preciso perguntar. */
export function pickClear<T>(cands: PersonCandidate<T>[]): { clear: T | null; ambiguous: T[] } {
  if (!cands.length) return { clear: null, ambiguous: [] };
  const [a, b] = cands;
  if (!b || a.score - b.score >= 0.2 || (a.score >= 1.2 && b.score < 1.2)) return { clear: a.item, ambiguous: [] };
  const top = cands.filter((c) => a.score - c.score < 0.2).map((c) => c.item);
  return { clear: null, ambiguous: top.slice(0, 6) };
}
