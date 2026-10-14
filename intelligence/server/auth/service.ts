import crypto from "node:crypto";
import type { Actor, Core } from "../core.js";
import { ensureOrganization } from "../core.js";
import type { Role } from "../../shared/types.js";
import { AppError, badRequest, forbidden, newId, notFound, nowIso, sha256 } from "../lib/util.js";
import { json } from "../db/db.js";
import { generateInviteCode, hashInviteCode, hashSecret, normalizeInviteCode, passwordProblems, verifySecret } from "./passwords.js";
import { audit } from "../domain/audit.js";

// ------------------------------------------------------------------ limites

/** Limita tentativas por chave (IP, e-mail…) numa janela deslizante. */
export function rateLimit(core: Core, key: string, limit: number, windowSec: number) {
  const now = Date.now();
  const since = now - windowSec * 1000;
  const row = core.db.get<{ n: number; first: number | null }>(
    "SELECT COUNT(*) AS n, MIN(at) AS first FROM rate_events WHERE key = ? AND at > ?",
    [key, since],
  );
  if (row && row.n >= limit) {
    const retry = Math.max(1, Math.ceil(((row.first ?? now) + windowSec * 1000 - now) / 1000));
    throw new AppError(429, "rate_limited", `Muitas tentativas. Aguarde ${retry > 90 ? Math.ceil(retry / 60) + " minutos" : retry + " segundos"} e tente de novo.`, {
      retryAfter: retry,
    });
  }
  core.db.run("INSERT INTO rate_events (key, at) VALUES (?, ?)", [key, now]);
}

export function clearRate(core: Core, key: string) {
  core.db.run("DELETE FROM rate_events WHERE key = ?", [key]);
}

// ------------------------------------------------------------------ convites

export interface InviteRow {
  id: string;
  org_id: string;
  code_hint: string;
  label: string;
  role: Role;
  scope_all: number;
  client_ids: string;
  max_uses: number | null;
  uses: number;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
  created_by: string | null;
}

export interface InviteInput {
  label: string;
  role: Role;
  scopeAll: boolean;
  clientIds?: string[];
  maxUses?: number | null;
  expiresInDays?: number | null;
  customCode?: string | null;
}

export function createInvite(core: Core, actor: Actor | null, input: InviteInput, orgId?: string) {
  const org = actor?.orgId ?? orgId ?? ensureOrganization(core);
  let code = generateInviteCode();
  if (input.customCode) {
    const norm = normalizeInviteCode(input.customCode);
    if (norm.length < 8) throw badRequest("O código personalizado precisa ter pelo menos 8 letras ou números.");
    code = input.customCode.trim().toUpperCase();
  }
  const codeHash = hashInviteCode(code, core.pepper);
  if (core.db.get("SELECT 1 FROM invites WHERE code_hash = ?", [codeHash])) throw badRequest("Esse código já está em uso. Escolha outro.");
  const id = newId("inv");
  const expires = input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000).toISOString() : null;
  core.db.run(
    `INSERT INTO invites (id, org_id, code_hash, code_hint, label, role, scope_all, client_ids, max_uses, expires_at, created_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      org,
      codeHash,
      normalizeInviteCode(code).slice(-3),
      input.label.trim().slice(0, 80) || "Convite",
      input.role,
      input.scopeAll ? 1 : 0,
      JSON.stringify(input.clientIds ?? []),
      input.maxUses ?? null,
      expires,
      actor?.id ?? null,
      nowIso(),
    ],
  );
  audit(core, actor, { source: actor ? "ui" : "system", action: "invite.create", entityType: "invite", entityId: id, summary: `Código de acesso "${input.label}" criado (${input.role})` }, org);
  return { id, code, expiresAt: expires };
}

export function listInvites(core: Core, actor: Actor) {
  return core.db
    .all<InviteRow>("SELECT * FROM invites WHERE org_id = ? ORDER BY created_at DESC", [actor.orgId])
    .map((r) => ({
      id: r.id,
      label: r.label,
      role: r.role,
      scopeAll: !!r.scope_all,
      clientIds: json<string[]>(r.client_ids, []),
      hint: `•••${r.code_hint}`,
      maxUses: r.max_uses,
      uses: r.uses,
      expiresAt: r.expires_at,
      revokedAt: r.revoked_at,
      createdAt: r.created_at,
      status: inviteStatus(r),
    }));
}

function inviteStatus(r: InviteRow): "ativo" | "revogado" | "expirado" | "esgotado" {
  if (r.revoked_at) return "revogado";
  if (r.expires_at && r.expires_at < nowIso()) return "expirado";
  if (r.max_uses !== null && r.uses >= r.max_uses) return "esgotado";
  return "ativo";
}

export function revokeInvite(core: Core, actor: Actor, id: string) {
  const r = core.db.run("UPDATE invites SET revoked_at = ? WHERE id = ? AND org_id = ? AND revoked_at IS NULL", [nowIso(), id, actor.orgId]);
  if (!r.changes) throw notFound("Código");
  audit(core, actor, { source: "ui", action: "invite.revoke", entityType: "invite", entityId: id, summary: "Código de acesso revogado" });
}

const INVALID_CODE = "Código inválido, expirado ou revogado.";

function findValidInvite(core: Core, code: string): InviteRow {
  const row = core.db.get<InviteRow>("SELECT * FROM invites WHERE code_hash = ?", [hashInviteCode(code, core.pepper)]);
  if (!row || inviteStatus(row) !== "ativo") throw new AppError(401, "invalid_code", INVALID_CODE);
  return row;
}

/** Etapa 1: valida o código e devolve um "passe" assinado, válido por 30 minutos, para criar a conta. */
export function checkInviteCode(core: Core, code: string, ip: string) {
  rateLimit(core, `gate:${ip}`, 10, 15 * 60);
  const invite = findValidInvite(core, code);
  clearRate(core, `gate:${ip}`);
  const exp = Date.now() + 30 * 60_000;
  const payload = `${invite.id}.${exp}`;
  const sig = crypto.createHmac("sha256", core.pepper).update("gate:" + payload).digest("base64url");
  return { pass: `${payload}.${sig}`, label: invite.label, role: invite.role };
}

function readGatePass(core: Core, pass: string): InviteRow {
  const [id, exp, sig] = pass.split(".");
  if (!id || !exp || !sig) throw new AppError(401, "invalid_code", "Digite o código de acesso novamente.");
  const expected = crypto.createHmac("sha256", core.pepper).update(`gate:${id}.${exp}`).digest("base64url");
  const ok = sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  if (!ok || Number(exp) < Date.now()) throw new AppError(401, "invalid_code", "O código expirou nesta tela. Digite-o novamente.");
  const row = core.db.get<InviteRow>("SELECT * FROM invites WHERE id = ?", [id]);
  if (!row || inviteStatus(row) !== "ativo") throw new AppError(401, "invalid_code", INVALID_CODE);
  return row;
}

// ------------------------------------------------------------------ contas

interface UserRow {
  id: string;
  org_id: string;
  name: string;
  email: string;
  password_hash: string;
  role: Role;
  scope_all: number;
  active: number;
  failed_logins: number;
  locked_until: string | null;
  created_at: string;
  last_login_at: string | null;
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;

export async function register(core: Core, pass: string, input: { name: string; email: string; password: string }, meta: { ip: string; ua: string }) {
  const invite = readGatePass(core, pass);
  const name = input.name.replace(/\s+/g, " ").trim();
  const email = input.email.trim().toLowerCase();
  if (name.length < 2) throw badRequest("Informe seu nome.");
  if (!EMAIL_RE.test(email)) throw badRequest("Informe um e-mail válido.");
  const problem = passwordProblems(input.password, email, name);
  if (problem) throw badRequest(problem);
  if (core.db.get("SELECT 1 FROM users WHERE email = ?", [email])) throw badRequest("Já existe uma conta com esse e-mail. Use a opção Entrar.");
  const hash = await hashSecret(input.password);
  const userId = newId("usr");
  core.db.tx(() => {
    // Revalida dentro da transação para não estourar o limite de usos em cadastros simultâneos.
    const fresh = core.db.get<InviteRow>("SELECT * FROM invites WHERE id = ?", [invite.id]);
    if (!fresh || inviteStatus(fresh) !== "ativo") throw new AppError(401, "invalid_code", INVALID_CODE);
    core.db.run("UPDATE invites SET uses = uses + 1 WHERE id = ?", [invite.id]);
    core.db.run(
      `INSERT INTO users (id, org_id, name, email, password_hash, role, scope_all, created_at, invite_id)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [userId, invite.org_id, name, email, hash, invite.role, invite.scope_all, nowIso(), invite.id],
    );
    for (const cid of json<string[]>(invite.client_ids, [])) {
      if (core.db.get("SELECT 1 FROM clients WHERE id = ? AND org_id = ?", [cid, invite.org_id]))
        core.db.run("INSERT OR IGNORE INTO user_client_access (user_id, client_id) VALUES (?, ?)", [userId, cid]);
    }
    audit(
      core,
      null,
      { source: "system", action: "user.register", entityType: "user", entityId: userId, summary: `${name} criou a conta usando o código "${invite.label}"` },
      invite.org_id,
    );
  });
  return createSession(core, userId, meta);
}

// Hash fictício para que e-mail inexistente leve o mesmo tempo que senha errada.
let dummyHash: Promise<string> | null = null;

export async function login(core: Core, input: { email: string; password: string }, meta: { ip: string; ua: string }) {
  const email = input.email.trim().toLowerCase();
  rateLimit(core, `login-ip:${meta.ip}`, 30, 15 * 60);
  rateLimit(core, `login-email:${email}`, 10, 15 * 60);
  const user = core.db.get<UserRow>("SELECT * FROM users WHERE email = ?", [email]);
  const generic = new AppError(401, "invalid_login", "E-mail ou senha incorretos.");
  if (!user) {
    dummyHash ??= hashSecret("dummy-password-for-timing");
    await verifySecret(input.password, await dummyHash);
    throw generic;
  }
  if (user.locked_until && user.locked_until > nowIso())
    throw new AppError(423, "locked", "Conta bloqueada temporariamente por excesso de tentativas. Tente novamente em alguns minutos.");
  const ok = await verifySecret(input.password, user.password_hash);
  if (!ok) {
    const failures = user.failed_logins + 1;
    const lock = failures >= 8 ? new Date(Date.now() + 15 * 60_000).toISOString() : null;
    core.db.run("UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?", [lock ? 0 : failures, lock, user.id]);
    if (lock)
      audit(core, null, { source: "system", action: "user.locked", entityType: "user", entityId: user.id, summary: `Conta de ${user.name} bloqueada por 15 min após tentativas erradas` }, user.org_id);
    throw generic;
  }
  if (!user.active) throw new AppError(403, "inactive", "Sua conta foi desativada. Fale com um administrador.");
  core.db.run("UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?", [nowIso(), user.id]);
  clearRate(core, `login-email:${email}`);
  return createSession(core, user.id, meta);
}

// ------------------------------------------------------------------ sessões

export function createSession(core: Core, userId: string, meta: { ip: string; ua: string }) {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = new Date();
  const expires = new Date(now.getTime() + core.cfg.sessionTtlHours * 3_600_000);
  core.db.run(
    "INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at, ip, user_agent) VALUES (?,?,?,?,?,?,?,?)",
    [newId("ses"), userId, sha256(token), now.toISOString(), expires.toISOString(), now.toISOString(), meta.ip, meta.ua.slice(0, 300)],
  );
  return { token, expiresAt: expires };
}

interface SessionJoin extends UserRow {
  session_id: string;
  expires_at: string;
  last_seen_at: string;
  revoked_at: string | null;
}

export function actorFromSession(core: Core, token: string | undefined, ip: string): Actor | null {
  if (!token || token.length > 100) return null;
  const row = core.db.get<SessionJoin>(
    `SELECT u.*, s.id AS session_id, s.expires_at, s.last_seen_at, s.revoked_at
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
    [sha256(token)],
  );
  if (!row || row.revoked_at || !row.active) return null;
  const now = Date.now();
  if (Date.parse(row.expires_at) < now) return null;
  if (now - Date.parse(row.last_seen_at) > core.cfg.sessionIdleMinutes * 60_000) return null;
  if (now - Date.parse(row.last_seen_at) > 60_000)
    core.db.run("UPDATE sessions SET last_seen_at = ? WHERE id = ?", [new Date(now).toISOString(), row.session_id]);
  const clientIds = row.scope_all
    ? new Set<string>()
    : new Set(core.db.all<{ client_id: string }>("SELECT client_id FROM user_client_access WHERE user_id = ?", [row.id]).map((r) => r.client_id));
  return { id: row.id, orgId: row.org_id, name: row.name, email: row.email, role: row.role, scopeAll: !!row.scope_all, clientIds, ip };
}

export function revokeSession(core: Core, token: string) {
  core.db.run("UPDATE sessions SET revoked_at = ? WHERE token_hash = ?", [nowIso(), sha256(token)]);
}

export function revokeAllSessions(core: Core, userId: string) {
  core.db.run("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL", [nowIso(), userId]);
}

export async function changePassword(core: Core, actor: Actor, current: string, next: string, keepToken: string) {
  rateLimit(core, `pw:${actor.id}`, 5, 15 * 60);
  const user = core.db.get<UserRow>("SELECT * FROM users WHERE id = ?", [actor.id]);
  if (!user || !(await verifySecret(current, user.password_hash))) throw badRequest("A senha atual não confere.");
  const problem = passwordProblems(next, user.email, user.name);
  if (problem) throw badRequest(problem);
  core.db.run("UPDATE users SET password_hash = ? WHERE id = ?", [await hashSecret(next), actor.id]);
  // Encerra as outras sessões abertas.
  core.db.run("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND token_hash <> ? AND revoked_at IS NULL", [nowIso(), actor.id, sha256(keepToken)]);
  audit(core, actor, { source: "ui", action: "user.password", entityType: "user", entityId: actor.id, summary: "Senha alterada" });
}

// ------------------------------------------------------------------ administração de usuários

export function listUsers(core: Core, actor: Actor) {
  return core.db
    .all<UserRow>("SELECT * FROM users WHERE org_id = ? ORDER BY active DESC, name", [actor.orgId])
    .map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      scopeAll: !!u.scope_all,
      active: !!u.active,
      createdAt: u.created_at,
      lastLoginAt: u.last_login_at,
      clientIds: core.db.all<{ client_id: string }>("SELECT client_id FROM user_client_access WHERE user_id = ?", [u.id]).map((r) => r.client_id),
    }));
}

export function updateUser(
  core: Core,
  actor: Actor,
  userId: string,
  patch: { role?: Role; active?: boolean; scopeAll?: boolean; clientIds?: string[] },
) {
  const user = core.db.get<UserRow>("SELECT * FROM users WHERE id = ? AND org_id = ?", [userId, actor.orgId]);
  if (!user) throw notFound("Usuário");
  const demotingAdmin = user.role === "admin" && ((patch.role && patch.role !== "admin") || patch.active === false);
  if (demotingAdmin) {
    const admins = core.db.get<{ n: number }>("SELECT COUNT(*) n FROM users WHERE org_id = ? AND role = 'admin' AND active = 1", [actor.orgId])!.n;
    if (admins <= 1) throw forbidden("É preciso manter pelo menos um administrador ativo.");
  }
  core.db.tx(() => {
    if (patch.role) core.db.run("UPDATE users SET role = ? WHERE id = ?", [patch.role, userId]);
    if (patch.active !== undefined) {
      core.db.run("UPDATE users SET active = ? WHERE id = ?", [patch.active ? 1 : 0, userId]);
      if (!patch.active) revokeAllSessions(core, userId);
    }
    if (patch.scopeAll !== undefined) core.db.run("UPDATE users SET scope_all = ? WHERE id = ?", [patch.scopeAll ? 1 : 0, userId]);
    if (patch.clientIds) {
      core.db.run("DELETE FROM user_client_access WHERE user_id = ?", [userId]);
      for (const cid of patch.clientIds)
        if (core.db.get("SELECT 1 FROM clients WHERE id = ? AND org_id = ?", [cid, actor.orgId]))
          core.db.run("INSERT INTO user_client_access (user_id, client_id) VALUES (?, ?)", [userId, cid]);
    }
    audit(core, actor, {
      source: "ui",
      action: "user.update",
      entityType: "user",
      entityId: userId,
      summary: `Permissões de ${user.name} alteradas`,
      details: { before: { role: user.role, active: !!user.active, scopeAll: !!user.scope_all }, after: patch },
    });
  });
}

export function userCount(core: Core): number {
  return core.db.get<{ n: number }>("SELECT COUNT(*) n FROM users")!.n;
}
