import { loadConfig } from "./config.js";
import { createCore, ensureOrganization } from "./core.js";
import { buildApp } from "./app.js";
import { startSchedulers } from "./domain/maintenance.js";
import { userCount } from "./auth/service.js";

const cfg = loadConfig();
const core = createCore(cfg);
ensureOrganization(core);
const app = await buildApp(core, { logger: true, trustProxy: process.env.TRUST_PROXY === "true" });
const stop = startSchedulers(core, (msg) => app.log.info(msg));

await app.listen({ port: cfg.port, host: cfg.host });
if (userCount(core) === 0)
  app.log.warn('Nenhum usuário cadastrado. Gere o primeiro código de administrador com: npm run invite -- --admin');
if (!cfg.cookieSecure) app.log.warn("COOKIE_SECURE=false: use apenas para testes locais (sem HTTPS).");

for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, async () => {
    stop();
    await app.close();
    core.db.close();
    process.exit(0);
  });
