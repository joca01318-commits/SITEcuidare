import { MONTHS_PT } from "../../../shared/types.js";

export function periodLabel(month: number | null, year: number | null): string {
  if (month && year) return `${MONTHS_PT[month - 1]} de ${year}`;
  if (month) return MONTHS_PT[month - 1];
  if (year) return String(year);
  return "Sem período";
}

export function relTime(iso: string): string {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 45) return "agora";
  if (diff < 3600) return `há ${Math.round(diff / 60)} min`;
  if (diff < 86400) return `há ${Math.round(diff / 3600)} h`;
  if (diff < 86400 * 7) {
    const days = Math.round(diff / 86400);
    return days === 1 ? "ontem" : `há ${days} dias`;
  }
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function initials(name: string): string {
  const parts = name.replace(/[^\p{L} ]/gu, "").trim().split(/\s+/).filter((p) => !/^(sr|sra|seu|dona|de|da|do|dos|das)$/i.test(p));
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

export function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

export function firstName(name: string) {
  return name.split(" ")[0];
}

export const SOURCE_LABEL: Record<string, string> = { ui: "Tela", import: "Importação", ai: "Assistente", system: "Sistema" };
