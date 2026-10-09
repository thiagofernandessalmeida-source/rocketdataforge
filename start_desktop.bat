@echo off
title CellFlow Data Studio - Desktop App
echo ================================================================
echo          CELLFLOW DATA STUDIO - APP DESKTOP (ELECTRON)
echo                       Build smart. Flow fast
echo ================================================================
echo.

cd /d "%~dp0ui"

if not exist "dist\index.html" (
    echo [INFO] Primeira execucao detectada: gerando bundle de producao...
    call npm run build
)

echo [INFO] Iniciando aplicativo Desktop nativo...
start "" npx electron electron/main.cjs
exit
