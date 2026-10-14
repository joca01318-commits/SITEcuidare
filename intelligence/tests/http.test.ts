import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeEnv, type TestEnv } from "./fixtures.js";
import { buildApp } from "../server/app.js";
import { createInvite } from "../server/auth/service.js";

let env: TestEnv;
let app: FastifyInstance;
const H = { "x-cuidare": "1", "content-type": "application/json" };

beforeEach(async () => {
  env = await makeEnv();
  app = await buildApp(env.core, { webDir: "/nao-existe" });
});
afterEach(async () => {
  await app.close();
  env.cleanup();
});

function cookieFrom(res: { headers: Record<string, unknown> }, name: string): string {
  const raw = res.headers["set-cookie"];
  const list = Array.isArray(raw) ? raw : [raw];
  const c = list.find((x) => String(x).startsWith(name + "="));
  return c ? String(c).split(";")[0] : "";
}

async function registerWithCode(code: string, email: string) {
  const gate = await app.inject({ method: "POST", url: "/api/auth/gate", headers: H, payload: { code } });
  expect(gate.statusCode).toBe(200);
  const reg = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    headers: { ...H, cookie: cookieFrom(gate, "ci_gate") },
    payload: { name: "Pessoa Teste", email, password: "frase-secreta-longa-1" },
  });
  expect(reg.statusCode).toBe(200);
  return cookieFrom(reg, "ci_session");
}

describe("API: autenticação e proteção", () => {
  it("exige sessão nas rotas de dados", async () => {
    const r = await app.inject({ method: "GET", url: "/api/spreadsheets" });
    expect(r.statusCode).toBe(401);
  });

  it("bloqueia escrita sem o cabeçalho anti-CSRF ou de outra origem", async () => {
    const a = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "a@b.com", password: "x" } });
    expect(a.statusCode).toBe(403);
    const b = await app.inject({ method: "POST", url: "/api/auth/login", headers: { ...H, origin: "https://site-malicioso.com", host: "localhost" }, payload: { email: "a@b.com", password: "x" } });
    expect(b.statusCode).toBe(403);
  });

  it("código → conta individual → sessão; código esgotado não reabre", async () => {
    const inv = createInvite(env.core, env.admin, { label: "Pai", role: "editor", scopeAll: true, maxUses: 1 });
    const cookie = await registerWithCode(inv.code, "pai@teste.com");
    const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } });
    expect(me.json().user).toMatchObject({ name: "Pessoa Teste", role: "editor" });
    const again = await app.inject({ method: "POST", url: "/api/auth/gate", headers: H, payload: { code: inv.code } });
    expect(again.statusCode).toBe(401);
    // O código nunca é guardado em texto puro.
    const row = env.core.db.get<{ code_hash: string }>("SELECT code_hash FROM invites WHERE id = ?", [inv.id])!;
    expect(row.code_hash).not.toContain(inv.code.replace(/-/g, ""));
    const user = env.core.db.get<{ password_hash: string }>("SELECT password_hash FROM users WHERE email = 'pai@teste.com'")!;
    expect(user.password_hash.startsWith("scrypt$")).toBe(true);
  });

  it("código revogado ou expirado não funciona", async () => {
    const inv = createInvite(env.core, env.admin, { label: "x", role: "viewer", scopeAll: true });
    env.core.db.run("UPDATE invites SET revoked_at = ? WHERE id = ?", [new Date().toISOString(), inv.id]);
    const r = await app.inject({ method: "POST", url: "/api/auth/gate", headers: H, payload: { code: inv.code } });
    expect(r.statusCode).toBe(401);
  });

  it("limita tentativas de código e de login", async () => {
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await app.inject({ method: "POST", url: "/api/auth/gate", headers: H, payload: { code: `ERRADO-${i}-XX` } })).statusCode;
    expect(last).toBe(429);
    const inv = createInvite(env.core, env.admin, { label: "y", role: "viewer", scopeAll: true });
    await registerWithCode(inv.code, "alvo@teste.com").catch(() => {});
    let status = 0;
    for (let i = 0; i < 11; i++) status = (await app.inject({ method: "POST", url: "/api/auth/login", headers: H, remoteAddress: `10.1.1.${i}`, payload: { email: "alvo@teste.com", password: "senha-errada-123" } })).statusCode;
    expect([423, 429]).toContain(status);
  });

  it("login, logout e sessão revogada", async () => {
    const inv = createInvite(env.core, env.admin, { label: "z", role: "editor", scopeAll: true });
    await registerWithCode(inv.code, "z@teste.com");
    const bad = await app.inject({ method: "POST", url: "/api/auth/login", headers: H, payload: { email: "z@teste.com", password: "errada-errada-1" } });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().message).toBe("E-mail ou senha incorretos.");
    const ok = await app.inject({ method: "POST", url: "/api/auth/login", headers: H, payload: { email: "Z@teste.com", password: "frase-secreta-longa-1" } });
    expect(ok.statusCode).toBe(200);
    const cookie = cookieFrom(ok, "ci_session");
    expect(String(ok.headers["set-cookie"])).toMatch(/HttpOnly/i);
    const out = await app.inject({ method: "POST", url: "/api/auth/logout", headers: { ...H, cookie }, payload: {} });
    expect(out.statusCode).toBe(200);
    const after = await app.inject({ method: "GET", url: "/api/dashboard", headers: { cookie } });
    expect(after.statusCode).toBe(401);
  });

  it("envia cabeçalhos de segurança", async () => {
    const r = await app.inject({ method: "GET", url: "/api/health" });
    expect(r.headers["content-security-policy"]).toMatch(/default-src 'self'/);
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["cache-control"]).toBe("no-store");
  });

  it("valida entradas e responde erros em português", async () => {
    const inv = createInvite(env.core, env.admin, { label: "w", role: "admin", scopeAll: true });
    const cookie = await registerWithCode(inv.code, "w@teste.com");
    const r = await app.inject({ method: "POST", url: "/api/spreadsheets", headers: { ...H, cookie }, payload: { title: "" } });
    expect(r.statusCode).toBe(400);
    expect(r.json().message).toMatch(/inválidos|nome/i);
    const nf = await app.inject({ method: "GET", url: "/api/spreadsheets/sh_inexistente", headers: { cookie } });
    expect(nf.statusCode).toBe(404);
    const viewerInv = createInvite(env.core, env.admin, { label: "v", role: "viewer", scopeAll: true });
    const vCookie = await registerWithCode(viewerInv.code, "v@teste.com");
    const forbidden = await app.inject({ method: "GET", url: "/api/admin/users", headers: { cookie: vCookie } });
    expect(forbidden.statusCode).toBe(403);
  });
});
