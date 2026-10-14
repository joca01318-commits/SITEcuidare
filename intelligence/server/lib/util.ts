import crypto from "node:crypto";

/** Identificador aleatório não sequencial (impede adivinhar endereços de outros registros). */
export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(12).toString("base64url")}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function sha256(input: string | Buffer): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/** Erro com status HTTP e mensagem pensada para o usuário final. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const notFound = (what = "Item") => new AppError(404, "not_found", `${what} não encontrado(a).`);
export const forbidden = (msg = "Você não tem permissão para esta ação.") => new AppError(403, "forbidden", msg);
export const badRequest = (msg: string, extra?: Record<string, unknown>) => new AppError(400, "bad_request", msg, extra);
export const conflict = (msg: string, extra?: Record<string, unknown>) => new AppError(409, "conflict", msg, extra);
