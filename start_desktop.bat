@echo off
title CellFlow Data Studio - Desktop App
echo ================================================================
echo          CELLFLOW DATA STUDIO - APP DESKTOP (ELECTRON)
echo                       Build smart. Flow fast
echo ================================================================
echo.

cd /d "%~dp0"

echo [INFO] Forcando encerramento de processos residuais (porta 8000)...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8000" ^| findstr "LISTENING"') do taskkill /F /T /PID %%p >nul 2>&1
taskkill /F /IM python.exe >nul 2>&1
taskkill /F /IM python3.12.exe >nul 2>&1
ping 127.0.0.1 -n 2 >nul

cd /d "%~dp0ui"

if not exist "dist\index.html" (
    echo [INFO] Primeira execucao detectada: gerando bundle de producao...
    call npm run build
)

echo [INFO] Iniciando aplicativo Desktop nativo...
start "" npx electron electron/main.cjs
exit
