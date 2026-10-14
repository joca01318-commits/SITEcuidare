@echo off
setlocal
chcp 65001 >nul
title Cuidare Intelligence
cd /d "%~dp0"

echo.
echo  ==============================================
echo    CUIDARE INTELLIGENCE - teste no computador
echo  ==============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo  O Node.js nao esta instalado.
  echo  1. Vai abrir o site do Node.js: baixe a versao LTS e instale ^(Avancar, Avancar...^).
  echo  2. Depois feche esta janela e de dois cliques neste arquivo de novo.
  start "" "https://nodejs.org/pt-br/download"
  pause
  exit /b 1
)

node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 (
  echo  Seu Node.js e antigo. Instale a versao LTS mais nova em https://nodejs.org/pt-br/download
  start "" "https://nodejs.org/pt-br/download"
  pause
  exit /b 1
)

if not exist ".env" (
  echo  Criando configuracao de teste local...
  (
    echo PORT=8787
    echo HOST=127.0.0.1
    echo DATA_DIR=./data
    echo COOKIE_SECURE=false
    echo AI_MODE=rules
  ) > ".env"
)

if not exist "node_modules" (
  echo  Instalando ^(so na primeira vez, leva 1 a 3 minutos^)...
  call npm ci --no-audit --no-fund
  if errorlevel 1 goto erro
)

if not exist "dist\server\index.js" (
  echo  Preparando o sistema ^(so na primeira vez^)...
  call npm run build
  if errorlevel 1 goto erro
)

call node --disable-warning=ExperimentalWarning dist/server/cli/invite.js --admin --if-no-users --label "Primeiro acesso" --save "CODIGO-DE-ACESSO.txt"
if exist "CODIGO-DE-ACESSO.txt" (
  echo  O codigo acima tambem foi salvo no arquivo CODIGO-DE-ACESSO.txt
  echo.
)

echo  Abrindo http://localhost:8787 no navegador...
echo  Para DESLIGAR o sistema, feche esta janela.
echo.
start "" cmd /c "timeout /t 3 >nul & start http://localhost:8787"
node --disable-warning=ExperimentalWarning dist/server/index.js
goto fim

:erro
echo.
echo  Algo deu errado. Tire um print desta janela e mande para o Claude.
pause
exit /b 1

:fim
pause
