import type { CellValue, Column, ColumnRole, ColumnType } from "./types.js";
import { formatDateBR, formatMoney, formatNumber, isIsoDate, normalize, parseDateBR, parseNumberBR } from "./text.js";
import { FormulaError, isCellFormula, type Value } from "./formula.js";

export const COLUMN_TYPE_LABEL: Record<ColumnType, string> = {
  text: "Texto",
  number: "Número",
  currency: "Valor (R$)",
  date: "Data",
  select: "Lista de opções",
  boolean: "Sim / Não",
  formula: "Calculada",
};

export type Coerced = { ok: true; value: CellValue } | { ok: false; error: string };

/** Valida e converte o que o usuário digitou para o tipo da coluna. */
export function coerceValue(col: Column, raw: unknown, opts: { year?: number } = {}): Coerced {
  if (col.type === "formula") return { ok: false, error: `"${col.name}" é calculada automaticamente e não pode ser editada.` };
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw === "string") {
    const s = raw.trim();
    if (s === "") return { ok: true, value: null };
    if (s.length > 5000) return { ok: false, error: "Texto longo demais (máx. 5000 caracteres)." };
    if (isCellFormula(s) && (col.type === "number" || col.type === "currency" || col.type === "text")) return { ok: true, value: s };
  }
  switch (col.type) {
    case "number":
    case "currency": {
      const n = parseNumberBR(raw);
      if (n === null) return { ok: false, error: `"${String(raw)}" não é um número válido para "${col.name}".` };
      if (Math.abs(n) > 1e12) return { ok: false, error: "Número grande demais." };
      return { ok: true, value: col.type === "currency" ? Math.round(n * 100) / 100 : n };
    }
    case "date": {
      if (typeof raw === "number") return { ok: false, error: `Data inválida para "${col.name}". Use DD/MM/AAAA.` };
      const d = parseDateBR(String(raw), opts.year);
      if (!d) return { ok: false, error: `"${String(raw)}" não é uma data válida. Use DD/MM/AAAA.` };
      return { ok: true, value: d };
    }
    case "boolean": {
      if (typeof raw === "boolean") return { ok: true, value: raw };
      const n = normalize(String(raw));
      if (["sim", "s", "true", "1", "verdadeiro", "x"].includes(n)) return { ok: true, value: true };
      if (["nao", "n", "false", "0", "falso"].includes(n)) return { ok: true, value: false };
      return { ok: false, error: `Use "Sim" ou "Não" em "${col.name}".` };
    }
    case "select": {
      const s = String(raw).trim();
      const opts2 = col.options ?? [];
      const hit = opts2.find((o) => normalize(o) === normalize(s));
      if (hit) return { ok: true, value: hit };
      if (!opts2.length) return { ok: true, value: s };
      return { ok: false, error: `"${s}" não está na lista de "${col.name}": ${opts2.join(", ")}.` };
    }
    default:
      return { ok: true, value: typeof raw === "string" ? raw.trim() : String(raw) };
  }
}

/** Texto exibido na célula. */
export function formatCell(col: Column, v: Value | CellValue): string {
  if (v instanceof FormulaError) return v.code;
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "boolean") return v ? "Sim" : "Não";
  if (col.type === "currency" || (col.type === "formula" && col.role !== "quantity" && typeof v === "number" && looksMoney(col)))
    return typeof v === "number" ? formatMoney(v) : String(v);
  if (typeof v === "number") return formatNumber(v);
  if (col.type === "date" || isIsoDate(v)) return formatDateBR(String(v));
  return String(v);
}

function looksMoney(col: Column) {
  return col.role === "amount" || col.role === "unit_value" || /\b(vr|valor|total|pgto|pagamento|r\$)\b/i.test(col.name);
}

export function isNumericColumn(col: Column): boolean {
  return col.type === "number" || col.type === "currency" || col.type === "formula";
}

export function newColumnId(existing: Column[]): string {
  const used = new Set(existing.map((c) => c.id));
  for (let i = existing.length + 1; ; i++) {
    const id = `c${i}`;
    if (!used.has(id)) return id;
  }
}

/** Detecta o papel de uma coluna pelo nome do cabeçalho. */
export function guessRole(name: string): ColumnRole | undefined {
  const n = normalize(name);
  if (/^(assistido|assistidos|assistidos fixos|paciente|cliente|idoso)\b/.test(n)) return "client";
  if (/^(cuidador|cuidadora|profissional|colaborador)/.test(n)) return "worker";
  if (/(situacao|status)/.test(n) && /(pg|pag)/.test(n)) return "status";
  if (/^status\b/.test(n)) return "status";
  if (/(vr|valor) ?(pgto|pagamento|pago|total)|pgto ?total|valor total|total pago/.test(n)) return "amount";
  if (/(data|dt) ?(pgto|pgmto|pagamento|pag)/.test(n)) return "payment_date";
  if (/^(qtd|quantidade)/.test(n)) return "quantity";
  if (/^(vr|valor) ?(plantao|diaria|unit)/.test(n) && !/\bcob/.test(n)) return "unit_value";
  if (/^faltas?\b/.test(n)) return "absences";
  if (/^(obs|observ)/.test(n)) return "notes";
  if (/^regime\b/.test(n)) return "regime";
  if (/^turno\b/.test(n)) return "shift";
  if (/^data\b/.test(n)) return "date";
  return undefined;
}

export function guessSensitive(name: string): boolean {
  const n = normalize(name);
  return /\b(pix|cpf|rg|cnpj|conta|agencia|banco|telefone|celular|whats|email|e mail|endereco|cep)\b/.test(n);
}

const PENDING_WORDS = ["pendente", "parcial", "em aberto", "aberto", "atrasado", "a pagar", "nao pago"];
const PAID_WORDS = ["pago", "paga", "quitado", "recebido", "ok"];

export function guessStatusValues(options: string[]): { pending: string[]; paid: string[] } {
  return {
    pending: options.filter((o) => PENDING_WORDS.includes(normalize(o))),
    paid: options.filter((o) => PAID_WORDS.includes(normalize(o))),
  };
}

export function findRole(columns: Column[], role: ColumnRole): Column | undefined {
  return columns.find((c) => c.role === role);
}
