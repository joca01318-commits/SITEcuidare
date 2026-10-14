#!/usr/bin/env bash
# Gera o pacote "baixe, descompacte e dê dois cliques" para testar no Windows.
# Inclui o Node.js portátil, então o computador não precisa de nenhuma instalação.
# Uso: bash tools/kit-windows.sh [pasta-de-saída]
set -euo pipefail
cd "$(dirname "$0")/.."
NODE_VERSION="${NODE_VERSION:-22.22.0}"
OUT="$(mkdir -p "${1:-./kit}" && cd "${1:-./kit}" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
KIT="$WORK/CuidareIntelligence"

npm run build >/dev/null
mkdir -p "$KIT/app" "$KIT/node"
cp -r dist package.json package-lock.json "$KIT/app/"
find "$KIT/app/dist" -name "*.map" -delete
(cd "$KIT/app" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund >/dev/null)
# Arquivos que não são usados em tempo de execução.
find "$KIT/app/node_modules" -type f \( -name "*.md" -o -name "*.map" -o -name "*.d.ts" -o -name "*.d.mts" -o -name "*.d.cts" -o -name "*.markdown" \) -delete
find "$KIT/app/node_modules" -mindepth 2 -maxdepth 3 -type d \( -name test -o -name tests -o -name __tests__ -o -name example -o -name examples \) -prune -exec rm -rf {} +
rm -f "$KIT/app/package-lock.json"

# Node.js portátil para Windows (licença MIT).
curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-win-x64.zip" -o "$WORK/node.zip"
unzip -q -j "$WORK/node.zip" "node-v$NODE_VERSION-win-x64/node.exe" "node-v$NODE_VERSION-win-x64/LICENSE" -d "$KIT/node"

printf 'PORT=8787\r\nHOST=127.0.0.1\r\nDATA_DIR=../dados\r\nCOOKIE_SECURE=false\r\nAI_MODE=rules\r\n' > "$KIT/app/.env"
cp tools/kit/ABRIR-CUIDARE.bat "$KIT/"
cp tools/kit/LEIA-ME.txt "$KIT/"

rm -f "$OUT/CuidareIntelligence-Windows.zip"
(cd "$WORK" && zip -qr -9 "$OUT/CuidareIntelligence-Windows.zip" CuidareIntelligence)
echo "$OUT/CuidareIntelligence-Windows.zip"
