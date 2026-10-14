// Utilitários de texto, números e datas em português do Brasil.

const HONORIFICS = new Set(["sr", "sra", "srta", "seu", "senhor", "senhora", "dona", "dna", "d", "dr", "dra"]);

/** minúsculas, sem acentos, sem pontuação, espaços simples. */
export function normalize(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Chave usada para reconhecer o mesmo cliente escrito de formas diferentes. */
export function nameKey(input: string): string {
  return normalize(input)
    .split(" ")
    .filter((w) => w && !HONORIFICS.has(w))
    .join(" ");
}

const LOWER_PARTICLES = new Set(["de", "da", "do", "das", "dos", "e"]);

/** "MARIA JOSÉ (ZEZE)" → "Maria José (Zeze)". Só mexe em textos todos em maiúsculas. */
export function prettyName(input: string): string {
  const trimmed = input.replace(/\s+/g, " ").trim();
  if (trimmed !== trimmed.toUpperCase()) return trimmed;
  return trimmed
    .toLowerCase()
    .split(" ")
    .map((w, i) => {
      if (i > 0 && LOWER_PARTICLES.has(w)) return w;
      const idx = w.search(/\p{L}/u);
      if (idx < 0) return w;
      return w.slice(0, idx) + w.charAt(idx).toUpperCase() + w.slice(idx + 1);
    })
    .join(" ");
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1);
  let cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

/** Similaridade entre palavras tolerante a erros de digitação. */
export function wordsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const len = Math.min(a.length, b.length);
  if (len < 4) return false;
  const limit = len >= 8 ? 2 : 1;
  return levenshtein(a, b) <= limit;
}

/**
 * Converte "1.234,56", "R$ 350", "350,00", "1234.5" em número.
 * Retorna null se não for um número.
 */
export function parseNumberBR(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  let s = raw.trim().replace(/^r\$\s*/i, "").replace(/\s+/g, "");
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  }
  if (!/^[\d.,]+$/.test(s)) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    // O separador que aparece por último é o decimal.
    if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    const decimals = s.length - lastComma - 1;
    s = (s.match(/,/g)!.length === 1 && decimals !== 3) ? s.replace(",", ".") : s.replace(/,/g, "");
  } else if (lastDot >= 0) {
    const parts = s.split(".");
    // "1.200" e "1.200.300" são milhares; "12.5" é decimal.
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3)) s = s.replace(/\./g, "");
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/** Arredonda a 2 casas sem erros de ponto flutuante (0.1 + 0.2). */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Soma valores monetários em centavos inteiros. */
export function sumMoney(values: number[]): number {
  let cents = 0;
  for (const v of values) cents += Math.round(v * 100);
  return cents / 100;
}

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const NUM = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 4 });

export function formatMoney(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  return BRL.format(n);
}

export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  return NUM.format(n);
}

/** Datas são guardadas como "AAAA-MM-DD". */
export function isIsoDate(s: unknown): boolean {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));
}

export function formatDateBR(iso: string | null | undefined): string {
  if (!iso || !isIsoDate(iso)) return iso ?? "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** Aceita "12/10/2026", "12/10", "2026-10-12". Sem ano, usa o ano informado. */
export function parseDateBR(raw: unknown, fallbackYear?: number): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (isIsoDate(s)) return s;
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  let y = m[3] ? Number(m[3]) : fallbackYear ?? new Date().getFullYear();
  if (y < 100) y += 2000;
  return makeIsoDate(y, mo, d);
}

export function makeIsoDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function todayIso(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
