#!/usr/bin/env bash
# Cuidare Intelligence — teste no computador (Mac ou Linux). Uso: bash iniciar-mac-linux.sh
set -e
cd "$(dirname "$0")"
echo
echo "  CUIDARE INTELLIGENCE - teste no computador"
echo
if ! command -v node >/dev/null 2>&1; then
  echo "  O Node.js não está instalado. Baixe a versão LTS em https://nodejs.org/pt-br/download e rode de novo."
  exit 1
fi
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)" || {
  echo "  Seu Node.js é antigo. Instale a versão LTS mais nova em https://nodejs.org/pt-br/download"; exit 1; }
if [ ! -f .env ]; then
  printf "PORT=8787\nHOST=127.0.0.1\nDATA_DIR=./data\nCOOKIE_SECURE=false\nAI_MODE=rules\n" > .env
fi
[ -d node_modules ] || { echo "  Instalando (só na primeira vez)..."; npm ci --no-audit --no-fund; }
[ -f dist/server/index.js ] || { echo "  Preparando o sistema (só na primeira vez)..."; npm run build; }
node --disable-warning=ExperimentalWarning dist/server/cli/invite.js --admin --if-no-users --label "Primeiro acesso" --save CODIGO-DE-ACESSO.txt
echo "  Abrindo http://localhost:8787 — para desligar, aperte Ctrl+C."
( sleep 3; (command -v open >/dev/null && open http://localhost:8787) || (command -v xdg-open >/dev/null && xdg-open http://localhost:8787) || true ) &
exec node --disable-warning=ExperimentalWarning dist/server/index.js
