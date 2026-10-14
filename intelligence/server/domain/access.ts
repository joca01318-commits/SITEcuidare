import type { Actor } from "../core.js";
import { forbidden } from "../lib/util.js";

export type Permission =
  | "read"
  | "edit"
  | "import"
  | "delete"
  | "manage_clients"
  | "manage_users"
  | "view_audit_all"
  | "restore"
  | "export"
  | "view_sensitive";

const MATRIX: Record<Actor["role"], Permission[]> = {
  admin: ["read", "edit", "import", "delete", "manage_clients", "manage_users", "view_audit_all", "restore", "export", "view_sensitive"],
  editor: ["read", "edit", "import", "delete", "manage_clients", "restore", "export", "view_sensitive"],
  viewer: ["read", "export"],
};

export function can(actor: Actor, perm: Permission): boolean {
  return MATRIX[actor.role].includes(perm);
}

export function require(actor: Actor, perm: Permission) {
  if (!can(actor, perm)) throw forbidden();
}

/** O usuário pode ver dados deste cliente? (null = registro sem cliente vinculado) */
export function canSeeClient(actor: Actor, clientId: string | null): boolean {
  if (actor.scopeAll) return true;
  if (clientId === null) return false;
  return actor.clientIds.has(clientId);
}

/**
 * Trecho SQL que limita registros aos clientes permitidos.
 * Usuário com acesso restrito só enxerga linhas vinculadas aos seus clientes.
 */
export function clientScopeSql(actor: Actor, column: string): { sql: string; params: string[] } {
  if (actor.scopeAll) return { sql: "1=1", params: [] };
  const ids = [...actor.clientIds];
  if (!ids.length) return { sql: "0=1", params: [] };
  return { sql: `${column} IN (${ids.map(() => "?").join(",")})`, params: ids };
}

export function maskSensitive(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const s = String(value);
  if (s.length <= 4) return "••••";
  return "••••" + s.slice(-3);
}
