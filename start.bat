@echo off
title CellFlow Data Studio - Launcher
echo ================================================================
echo          CELLFLOW DATA STUDIO - STUDIO DE ENGENHARIA DE DADOS
echo                       Build smart. Flow fast
echo ================================================================
echo.

cd /d "%~dp0"

echo [INFO] Forcando encerramento de processos residuais (portas 8000 e 5173)...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8000" ^| findstr "LISTENING"') do taskkill /F /T /PID %%p >nul 2>&1
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":5173" ^| findstr "LISTENING"') do taskkill /F /T /PID %%p >nul 2>&1
taskkill /F /IM python.exe >nul 2>&1
taskkill /F /IM python3.12.exe >nul 2>&1
ping 127.0.0.1 -n 2 >nul

if "%1"=="web" goto run_web
if "%1"=="desktop" goto run_desktop

rem Se o bundle desktop existir, inicia o Desktop App por padrao:
if exist "%~dp0ui\dist\index.html" goto run_desktop

:run_web
echo [INFO] Iniciando no Navegador (Web)...
call "%~dp0start_rocketdataforge.bat"
goto end

:run_desktop
echo [INFO] Iniciando no Modo Desktop (Electron)...
call "%~dp0start_desktop.bat"
goto end

:end
