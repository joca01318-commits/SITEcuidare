import path from "node:path";
import fs from "node:fs";

function loadDotEnv() {
  const file = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trimStart().startsWith("#")) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, "$2");
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}
loadDotEnv();

const env = process.env;
const isProd = env.NODE_ENV === "production";

function bool(v: string | undefined, fallback: boolean) {
  if (v === undefined || v === "") return fallback;
  return ["1", "true", "yes", "sim"].includes(v.toLowerCase());
}

function int(v: string | undefined, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) && v !== "" && v !== undefined ? n : fallback;
}

export type AiMode = "rules" | "hybrid" | "llm";

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  isProd: boolean;
  cookieSecure: boolean;
  appOrigin: string | null;
  sessionTtlHours: number;
  sessionIdleMinutes: number;
  maxUploadMb: number;
  backupEveryHours: number;
  backupKeep: number;
  trashRetentionDays: number;
  ai: {
    mode: AiMode;
    baseUrl: string;
    apiKey: string;
    model: string;
    providerIsLocal: boolean;
    timeoutMs: number;
  };
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const mode = (env.AI_MODE ?? "rules") as AiMode;
  const cfg: Config = {
    port: int(env.PORT, 8787),
    host: env.HOST ?? "127.0.0.1",
    dataDir: path.resolve(env.DATA_DIR ?? "./data"),
    isProd,
    cookieSecure: bool(env.COOKIE_SECURE, isProd),
    appOrigin: env.APP_ORIGIN || null,
    sessionTtlHours: int(env.SESSION_TTL_HOURS, 24 * 30),
    sessionIdleMinutes: int(env.SESSION_IDLE_MINUTES, 60 * 24 * 7),
    maxUploadMb: int(env.MAX_UPLOAD_MB, 15),
    backupEveryHours: int(env.BACKUP_EVERY_HOURS, 24),
    backupKeep: int(env.BACKUP_KEEP, 14),
    trashRetentionDays: int(env.TRASH_RETENTION_DAYS, 30),
    ai: {
      mode: ["rules", "hybrid", "llm"].includes(mode) ? mode : "rules",
      baseUrl: (env.AI_BASE_URL ?? "").replace(/\/+$/, ""),
      apiKey: env.AI_API_KEY ?? "",
      model: env.AI_MODEL ?? "",
      providerIsLocal: bool(env.AI_PROVIDER_LOCAL, false),
      timeoutMs: int(env.AI_TIMEOUT_MS, 60_000),
    },
    ...overrides,
  };
  return cfg;
}
