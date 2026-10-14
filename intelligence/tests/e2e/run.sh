#!/usr/bin/env bash
# Sobe um servidor descartável com dados fictícios e roda o teste no navegador.
# Uso: bash tests/e2e/run.sh <pasta-de-saída>
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT="${1:-./test-results/e2e}"
DATA="$(mktemp -d)"
PORT="${E2E_PORT:-8799}"
mkdir -p "$OUT"
npx tsx -e "import('./tests/fixtures.ts').then(async (m) => require('node:fs').writeFileSync('$DATA/teste.xlsx', await m.buildWorkbook()))" 2>/dev/null
CODE="E2E-$(date +%s)-OK"
DATA_DIR="$DATA" npx tsx server/cli/invite.ts --admin --code "$CODE" >/dev/null 2>&1
DATA_DIR="$DATA" COOKIE_SECURE=false PORT="$PORT" HOST=127.0.0.1 BACKUP_EVERY_HOURS=0 node --import tsx server/index.ts >"$OUT/server.log" 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null; rm -rf "$DATA"' EXIT
for _ in $(seq 1 40); do curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null && break; sleep 0.25; done
E2E_URL="http://127.0.0.1:$PORT" E2E_CODE="$CODE" E2E_FILE="$DATA/teste.xlsx" E2E_OUT="$OUT" npx tsx tests/e2e/flow.mts
