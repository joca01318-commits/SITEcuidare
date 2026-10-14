import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt) as (pw: string | Buffer, salt: Buffer, len: number, opts: crypto.ScryptOptions) => Promise<Buffer>;

// scrypt (memória-intensivo) com parâmetros recomendados pela OWASP.
const N = 2 ** 15;
const r = 8;
const p = 1;
const KEYLEN = 32;
const MAXMEM = 64 * 1024 * 1024;

export async function hashSecret(secret: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(secret.normalize("NFKC"), salt, KEYLEN, { N, r, p, maxmem: MAXMEM });
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, rr, pp, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, "base64");
  const key = await scrypt(secret.normalize("NFKC"), Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(n),
    r: Number(rr),
    p: Number(pp),
    maxmem: MAXMEM,
  });
  return crypto.timingSafeEqual(key, expected);
}

/**
 * Códigos de convite: alta entropia, guardados como HMAC-SHA256 (permite busca exata
 * sem guardar o código em texto puro). A chave fica fora do banco, em DATA_DIR/secret.key.
 */
export function hashInviteCode(code: string, pepper: Buffer): string {
  return crypto.createHmac("sha256", pepper).update(normalizeInviteCode(code)).digest("hex");
}

export function normalizeInviteCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem 0/O e 1/I para evitar confusão

export function generateInviteCode(): string {
  const bytes = crypto.randomBytes(12);
  let out = "";
  for (let i = 0; i < 12; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`;
}

export function passwordProblems(pw: string, email?: string, name?: string): string | null {
  if (pw.length < 10) return "A senha precisa ter pelo menos 10 caracteres.";
  if (pw.length > 200) return "Senha longa demais.";
  if (/^(.)\1+$/.test(pw)) return "A senha não pode ser um único caractere repetido.";
  const lower = pw.toLowerCase();
  const common = ["1234567890", "0123456789", "senha12345", "password12", "cuidare123", "qwertyuiop"];
  if (common.some((c) => lower.includes(c))) return "Essa senha é muito comum. Escolha outra.";
  if (email && lower.includes(email.toLowerCase().split("@")[0]) && email.split("@")[0].length >= 4)
    return "A senha não pode conter o seu e-mail.";
  if (name && name.length >= 4 && lower.includes(name.toLowerCase().split(" ")[0]) && name.split(" ")[0].length >= 4)
    return "A senha não pode conter o seu nome.";
  return null;
}
