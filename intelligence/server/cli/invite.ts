// Gera um código de acesso pelo terminal do servidor.
// Uso: npm run invite -- --admin                 (primeiro administrador)
//      npm run invite -- --role editor --label "Equipe" --days 30 --uses 5
//      npm run invite -- --admin --code "CUIDARE-2026"   (código fixo escolhido por você)
import { loadConfig } from "../config.js";
import { createCore, ensureOrganization } from "../core.js";
import { createInvite } from "../auth/service.js";
import type { Role } from "../../shared/types.js";

const args = process.argv.slice(2);
const get = (flag: string) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const role: Role = args.includes("--admin") ? "admin" : ((get("--role") as Role) ?? "editor");
if (!["admin", "editor", "viewer"].includes(role)) {
  console.error("Papel inválido. Use admin, editor ou viewer.");
  process.exit(1);
}
const core = createCore(loadConfig());
const orgId = ensureOrganization(core);
const days = get("--days");
const uses = get("--uses");
const inv = createInvite(
  core,
  null,
  {
    label: get("--label") ?? (role === "admin" ? "Administrador" : "Convite"),
    role,
    scopeAll: true,
    maxUses: uses ? Number(uses) : role === "admin" ? 1 : null,
    expiresInDays: days ? Number(days) : role === "admin" ? 7 : null,
    customCode: get("--code") ?? null,
  },
  orgId,
);
console.log(`\nCódigo de acesso (${role}): ${inv.code}`);
console.log(inv.expiresAt ? `Válido até: ${new Date(inv.expiresAt).toLocaleString("pt-BR")}` : "Sem data de expiração.");
console.log("Guarde agora: por segurança ele não é armazenado em texto e não poderá ser exibido de novo.\n");
core.db.close();
