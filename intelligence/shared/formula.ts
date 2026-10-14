// Motor de fórmulas próprio: tokenizador, parser descendente recursivo e avaliador.
// Não usa eval nem Function: a fórmula só consegue ler células da mesma linha e
// chamar as funções listadas em FUNCTIONS.

import type { CellValue, Column, RowData } from "./types.js";
import { isIsoDate, normalize, parseNumberBR } from "./text.js";

export type ErrorCode = "#VALOR!" | "#DIV/0!" | "#REF!" | "#NOME?" | "#ERRO!" | "#CICLO!";

export class FormulaError {
  constructor(public readonly code: ErrorCode, public readonly detail = "") {}
  toString() {
    return this.code;
  }
}

export type Value = number | string | boolean | null | FormulaError;

type Token =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "ref"; v: string; byName: boolean }
  | { t: "id"; v: string }
  | { t: "op"; v: string }
  | { t: "(" }
  | { t: ")" }
  | { t: "," };

export type Node =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "bool"; v: boolean }
  | { k: "ref"; id: string }
  | { k: "un"; op: string; a: Node }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "pct"; a: Node }
  | { k: "call"; fn: string; args: Node[] };

export class FormulaSyntaxError extends Error {}

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      if (src[j] === "e" || src[j] === "E") {
        let k = j + 1;
        if (src[k] === "+" || src[k] === "-") k++;
        if (/[0-9]/.test(src[k] ?? "")) {
          j = k;
          while (j < src.length && /[0-9]/.test(src[j])) j++;
        }
      }
      const v = Number(src.slice(i, j));
      if (!Number.isFinite(v)) throw new FormulaSyntaxError(`Número inválido: ${src.slice(i, j)}`);
      out.push({ t: "num", v });
      i = j;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let s = "";
      while (j < src.length) {
        if (src[j] === '"') {
          if (src[j + 1] === '"') {
            s += '"';
            j += 2;
            continue;
          }
          break;
        }
        s += src[j++];
      }
      if (src[j] !== '"') throw new FormulaSyntaxError("Texto sem aspas de fechamento");
      out.push({ t: "str", v: s });
      i = j + 1;
      continue;
    }
    if (c === "{" || c === "[") {
      const close = c === "{" ? "}" : "]";
      const j = src.indexOf(close, i + 1);
      if (j < 0) throw new FormulaSyntaxError(`Referência sem "${close}"`);
      out.push({ t: "ref", v: src.slice(i + 1, j).trim(), byName: c === "[" });
      i = j + 1;
      continue;
    }
    if (/[\p{L}_]/u.test(c)) {
      let j = i;
      while (j < src.length && /[\p{L}\p{N}_.]/u.test(src[j])) j++;
      out.push({ t: "id", v: src.slice(i, j) });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === "<=" || two === ">=" || two === "<>") {
      out.push({ t: "op", v: two });
      i += 2;
      continue;
    }
    if ("+-*/^&=<>%".includes(c)) {
      out.push({ t: "op", v: c });
      i++;
      continue;
    }
    if (c === "(") out.push({ t: "(" });
    else if (c === ")") out.push({ t: ")" });
    else if (c === "," || c === ";") out.push({ t: "," });
    else throw new FormulaSyntaxError(`Caractere inesperado: ${c}`);
    i++;
  }
  return out;
}

export interface RefResolver {
  /** Recebe o texto entre {} ou [] e devolve o id da coluna, ou null. */
  (ref: string, byName: boolean): string | null;
}

export function parse(src: string, resolve: RefResolver): Node {
  const text = src.trim().replace(/^=/, "");
  if (!text) throw new FormulaSyntaxError("Fórmula vazia");
  const toks = tokenize(text);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (...ops: string[]) => {
    const t = toks[p];
    return t?.t === "op" && ops.includes(t.v);
  };

  function comparison(): Node {
    let a = concat();
    while (isOp("=", "<>", "<", ">", "<=", ">=")) {
      const op = (toks[p++] as { v: string }).v;
      a = { k: "bin", op, a, b: concat() };
    }
    return a;
  }
  function concat(): Node {
    let a = additive();
    while (isOp("&")) {
      p++;
      a = { k: "bin", op: "&", a, b: additive() };
    }
    return a;
  }
  function additive(): Node {
    let a = multiplicative();
    while (isOp("+", "-")) {
      const op = (toks[p++] as { v: string }).v;
      a = { k: "bin", op, a, b: multiplicative() };
    }
    return a;
  }
  function multiplicative(): Node {
    let a = power();
    while (isOp("*", "/")) {
      const op = (toks[p++] as { v: string }).v;
      a = { k: "bin", op, a, b: power() };
    }
    return a;
  }
  function power(): Node {
    let a = unary();
    while (isOp("^")) {
      p++;
      a = { k: "bin", op: "^", a, b: unary() };
    }
    return a;
  }
  function unary(): Node {
    if (isOp("-", "+")) {
      const op = (toks[p++] as { v: string }).v;
      return { k: "un", op, a: unary() };
    }
    let a = primary();
    while (isOp("%")) {
      p++;
      a = { k: "pct", a };
    }
    return a;
  }
  function primary(): Node {
    const t = peek();
    if (!t) throw new FormulaSyntaxError("Fórmula incompleta");
    p++;
    switch (t.t) {
      case "num":
        return { k: "num", v: t.v };
      case "str":
        return { k: "str", v: t.v };
      case "ref": {
        const id = resolve(t.v, t.byName);
        if (!id) throw new FormulaSyntaxError(`Coluna não encontrada: ${t.v}`);
        return { k: "ref", id };
      }
      case "(": {
        const e = comparison();
        if (peek()?.t !== ")") throw new FormulaSyntaxError('Faltou ")"');
        p++;
        return e;
      }
      case "id": {
        const name = canonicalFn(t.v);
        if (peek()?.t !== "(") {
          if (name === "TRUE" || name === "VERDADEIRO") return { k: "bool", v: true };
          if (name === "FALSE" || name === "FALSO") return { k: "bool", v: false };
          // Nome solto: tenta como coluna (permite "Valor" sem colchetes quando não há ambiguidade).
          const id = resolve(t.v, true);
          if (id) return { k: "ref", id };
          throw new FormulaSyntaxError(`Nome desconhecido: ${t.v}`);
        }
        p++;
        const args: Node[] = [];
        if (peek()?.t !== ")") {
          for (;;) {
            args.push(comparison());
            if (peek()?.t === ",") {
              p++;
              continue;
            }
            break;
          }
        }
        if (peek()?.t !== ")") throw new FormulaSyntaxError(`Faltou ")" em ${t.v}`);
        p++;
        if (!FUNCTIONS[name]) throw new FormulaSyntaxError(`Função desconhecida: ${t.v}`);
        return { k: "call", fn: name, args };
      }
      default:
        throw new FormulaSyntaxError("Expressão inválida");
    }
  }

  const node = comparison();
  if (p < toks.length) throw new FormulaSyntaxError("Sobrou texto no final da fórmula");
  return node;
}

function canonicalFn(name: string): string {
  return normalize(name).replace(/ /g, ".").toUpperCase();
}

// ---------------------------------------------------------------- avaliação

const DAY_MS = 86_400_000;

function toNumber(v: Value): number | FormulaError {
  if (v instanceof FormulaError) return v;
  if (v === null || v === "") return 0;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (isIsoDate(v)) return Date.parse(v + "T00:00:00Z") / DAY_MS;
  const n = parseNumberBR(v);
  return n === null ? new FormulaError("#VALOR!", `"${v}" não é um número`) : n;
}

function toText(v: Value): string {
  if (v === null) return "";
  if (typeof v === "boolean") return v ? "VERDADEIRO" : "FALSO";
  if (typeof v === "number") return String(clean(v)).replace(".", ",");
  return String(v);
}

function toBool(v: Value): boolean | FormulaError {
  if (v instanceof FormulaError) return v;
  if (typeof v === "boolean") return v;
  if (v === null || v === "") return false;
  if (typeof v === "number") return v !== 0;
  const n = normalize(v);
  if (n === "verdadeiro" || n === "true" || n === "sim") return true;
  if (n === "falso" || n === "false" || n === "nao") return false;
  return new FormulaError("#VALOR!");
}

function clean(n: number): number {
  return Math.round(n * 1e10) / 1e10;
}

function compare(a: Value, b: Value): number {
  const blankA = a === null || a === "";
  const blankB = b === null || b === "";
  if (blankA && blankB) return 0;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "number" && blankB) return a;
  if (typeof b === "number" && blankA) return -b;
  const sa = normalize(toText(a));
  const sb = normalize(toText(b));
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

type Fn = (args: Node[], ev: (n: Node) => Value) => Value;

function numericArgs(args: Node[], ev: (n: Node) => Value): number[] | FormulaError {
  const out: number[] = [];
  for (const a of args) {
    const v = ev(a);
    if (v instanceof FormulaError) return v;
    if (v === null || v === "") continue;
    const n = toNumber(v);
    if (n instanceof FormulaError) {
      // Como no Excel: texto em SOMA é ignorado.
      if (typeof v === "string") continue;
      return n;
    }
    out.push(n);
  }
  return out;
}

const FUNCTIONS: Record<string, Fn> = {};
function def(names: string[], fn: Fn) {
  for (const n of names) FUNCTIONS[n] = fn;
}

def(["SUM", "SOMA"], (args, ev) => {
  const ns = numericArgs(args, ev);
  return ns instanceof FormulaError ? ns : ns.reduce((s, n) => s + n, 0);
});
def(["AVERAGE", "MEDIA"], (args, ev) => {
  const ns = numericArgs(args, ev);
  if (ns instanceof FormulaError) return ns;
  return ns.length ? ns.reduce((s, n) => s + n, 0) / ns.length : new FormulaError("#DIV/0!");
});
def(["MIN", "MINIMO"], (args, ev) => {
  const ns = numericArgs(args, ev);
  return ns instanceof FormulaError ? ns : ns.length ? Math.min(...ns) : 0;
});
def(["MAX", "MAXIMO"], (args, ev) => {
  const ns = numericArgs(args, ev);
  return ns instanceof FormulaError ? ns : ns.length ? Math.max(...ns) : 0;
});
def(["ROUND", "ARRED", "ARREDONDAR"], (args, ev) => {
  const n = toNumber(ev(args[0] ?? { k: "num", v: 0 }));
  if (n instanceof FormulaError) return n;
  const d = args[1] ? toNumber(ev(args[1])) : 0;
  if (d instanceof FormulaError) return d;
  const f = 10 ** Math.trunc(d);
  return Math.round((n + Math.sign(n) * Number.EPSILON) * f) / f;
});
def(["INT", "INTEIRO"], (args, ev) => {
  const n = toNumber(ev(args[0] ?? { k: "num", v: 0 }));
  return n instanceof FormulaError ? n : Math.floor(n);
});
def(["ABS"], (args, ev) => {
  const n = toNumber(ev(args[0] ?? { k: "num", v: 0 }));
  return n instanceof FormulaError ? n : Math.abs(n);
});
def(["IF", "SE"], (args, ev) => {
  const c = toBool(ev(args[0] ?? { k: "bool", v: false }));
  if (c instanceof FormulaError) return c;
  const branch = c ? args[1] : args[2];
  return branch ? ev(branch) : c;
});
def(["IFERROR", "SEERRO"], (args, ev) => {
  const v = ev(args[0] ?? { k: "num", v: 0 });
  return v instanceof FormulaError ? (args[1] ? ev(args[1]) : "") : v;
});
def(["AND", "E"], (args, ev) => {
  for (const a of args) {
    const b = toBool(ev(a));
    if (b instanceof FormulaError) return b;
    if (!b) return false;
  }
  return true;
});
def(["OR", "OU"], (args, ev) => {
  for (const a of args) {
    const b = toBool(ev(a));
    if (b instanceof FormulaError) return b;
    if (b) return true;
  }
  return false;
});
def(["NOT", "NAO"], (args, ev) => {
  const b = toBool(ev(args[0] ?? { k: "bool", v: false }));
  return b instanceof FormulaError ? b : !b;
});
def(["CONCAT", "CONCATENAR"], (args, ev) => {
  let s = "";
  for (const a of args) {
    const v = ev(a);
    if (v instanceof FormulaError) return v;
    s += toText(v);
  }
  return s;
});
def(["UPPER", "MAIUSCULA"], (args, ev) => {
  const v = ev(args[0] ?? { k: "str", v: "" });
  return v instanceof FormulaError ? v : toText(v).toUpperCase();
});
def(["LOWER", "MINUSCULA"], (args, ev) => {
  const v = ev(args[0] ?? { k: "str", v: "" });
  return v instanceof FormulaError ? v : toText(v).toLowerCase();
});
def(["ISBLANK", "ECEL.VAZIA"], (args, ev) => {
  const v = ev(args[0] ?? { k: "str", v: "" });
  return v === null || v === "";
});
def(["TODAY", "HOJE"], () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
});

export function evaluate(node: Node, getRef: (id: string) => Value): Value {
  const ev = (n: Node): Value => {
    switch (n.k) {
      case "num":
        return n.v;
      case "str":
        return n.v;
      case "bool":
        return n.v;
      case "ref":
        return getRef(n.id);
      case "pct": {
        const a = toNumber(ev(n.a));
        return a instanceof FormulaError ? a : a / 100;
      }
      case "un": {
        const a = toNumber(ev(n.a));
        if (a instanceof FormulaError) return a;
        return n.op === "-" ? -a : a;
      }
      case "call":
        return FUNCTIONS[n.fn](n.args, ev);
      case "bin": {
        const av = ev(n.a);
        const bv = ev(n.b);
        if (av instanceof FormulaError) return av;
        if (bv instanceof FormulaError) return bv;
        if (n.op === "&") return toText(av) + toText(bv);
        if (["=", "<>", "<", ">", "<=", ">="].includes(n.op)) {
          const c = compare(av, bv);
          switch (n.op) {
            case "=":
              return c === 0;
            case "<>":
              return c !== 0;
            case "<":
              return c < 0;
            case ">":
              return c > 0;
            case "<=":
              return c <= 0;
            default:
              return c >= 0;
          }
        }
        const a = toNumber(av);
        if (a instanceof FormulaError) return a;
        const b = toNumber(bv);
        if (b instanceof FormulaError) return b;
        switch (n.op) {
          case "+":
            return a + b;
          case "-":
            return a - b;
          case "*":
            return a * b;
          case "/":
            return b === 0 ? new FormulaError("#DIV/0!") : a / b;
          case "^":
            return a ** b;
        }
        return new FormulaError("#ERRO!");
      }
    }
  };
  const out = ev(node);
  if (typeof out === "number") return Number.isFinite(out) ? clean(out) : new FormulaError("#VALOR!");
  return out;
}

// --------------------------------------------------------- uso com colunas

export function columnResolver(columns: Column[]): RefResolver {
  const byId = new Map(columns.map((c) => [c.id, c.id]));
  const byName = new Map<string, string>();
  for (const c of columns) {
    const key = normalize(c.name);
    if (!byName.has(key)) byName.set(key, c.id);
  }
  return (ref, isName) => {
    if (!isName && byId.has(ref)) return ref;
    return byName.get(normalize(ref)) ?? (byId.has(ref) ? ref : null);
  };
}

/** "[Qtd] * [Valor]" → "{c1} * {c2}" (formato guardado). Lança FormulaSyntaxError se inválida. */
export function toStoredFormula(src: string, columns: Column[]): string {
  const resolve = columnResolver(columns);
  parse(src, resolve);
  return src
    .trim()
    .replace(/^=/, "")
    .replace(/\[([^\]]+)\]/g, (_, name: string) => `{${resolve(name, true)}}`);
}

/** "{c1} * {c2}" → "[Qtd] * [Valor]" (formato exibido). */
export function toDisplayFormula(stored: string, columns: Column[]): string {
  const names = new Map(columns.map((c) => [c.id, c.name]));
  return stored.replace(/\{([^}]+)\}/g, (m, id: string) => (names.has(id) ? `[${names.get(id)}]` : m));
}

export function referencedColumns(stored: string): string[] {
  return [...stored.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
}

const astCache = new Map<string, Node | FormulaError>();

function compileCached(src: string, columns: Column[]): Node | FormulaError {
  const key = src + "\u0000" + columns.map((c) => c.id).join(",");
  let hit = astCache.get(key);
  if (hit === undefined) {
    try {
      hit = parse(src, columnResolver(columns));
    } catch (e) {
      hit = new FormulaError(e instanceof FormulaSyntaxError && /Coluna|Nome/.test(e.message) ? "#REF!" : "#NOME?", (e as Error).message);
    }
    if (astCache.size > 5000) astCache.clear();
    astCache.set(key, hit);
  }
  return hit;
}

export function isCellFormula(v: CellValue): v is string {
  return typeof v === "string" && v.startsWith("=") && v.length > 1;
}

/**
 * Calcula os valores exibidos de uma linha: colunas calculadas e células com fórmula.
 * Detecta referências circulares.
 */
export function computeRow(data: RowData, columns: Column[]): Record<string, Value> {
  const out: Record<string, Value> = {};
  const state = new Map<string, 0 | 1 | 2>(); // 1 = calculando, 2 = pronto
  const colById = new Map(columns.map((c) => [c.id, c]));

  const get = (id: string): Value => {
    const col = colById.get(id);
    if (!col) return new FormulaError("#REF!");
    const s = state.get(id);
    if (s === 2) return out[id];
    if (s === 1) return new FormulaError("#CICLO!");
    const raw = data[id] ?? null;
    const src = col.type === "formula" ? col.formula ?? "" : isCellFormula(raw) ? raw : null;
    if (src === null) {
      state.set(id, 2);
      out[id] = raw;
      return raw;
    }
    state.set(id, 1);
    const ast = compileCached(src, columns);
    const v = ast instanceof FormulaError ? ast : evaluate(ast, get);
    state.set(id, 2);
    out[id] = v;
    return v;
  };

  for (const c of columns) get(c.id);
  return out;
}

export function displayValue(v: Value): CellValue {
  return v instanceof FormulaError ? v.code : v;
}
