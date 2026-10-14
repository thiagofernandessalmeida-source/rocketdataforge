@echo off
title CellFlow Data Studio - Launcher

echo ================================================================
echo          CELLFLOW DATA STUDIO - STUDIO DE ENGENHARIA DE DADOS
echo                       Build smart. Flow fast
echo ================================================================
echo.

cd /d "%~dp0"

set "PYTHON_EXE=python"
if exist "%~dp0.venv\Scripts\python.exe" (
    set "PYTHON_EXE=%~dp0.venv\Scripts\python.exe"
    echo [INFO] Utilizando ambiente virtual (.venv): "%~dp0.venv\Scripts\python.exe"
) else (
    echo [INFO] Ambiente virtual nao encontrado. Utilizando Python padrao do sistema.
)

rem Configuracao automatica do Oracle Instant Client (priorizando 19c)
if exist "C:\oracle\instantclient_19_32" (
    set "PATH=C:\oracle\instantclient_19_32;%PATH%"
    set "OCI_LIB_DIR=C:\oracle\instantclient_19_32"
    echo [INFO] Oracle Instant Client 19c detectado: C:\oracle\instantclient_19_32
) else if exist "C:\oracle\instantclient" (
    set "PATH=C:\oracle\instantclient;%PATH%"
    set "OCI_LIB_DIR=C:\oracle\instantclient"
    echo [INFO] Oracle Instant Client detectado: C:\oracle\instantclient
)

echo [INFO] Forcando reinicializacao limpa (liberando portas 8000 e 5173)...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8000" ^| findstr "LISTENING"') do taskkill /F /T /PID %%p >nul 2>&1
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":5173" ^| findstr "LISTENING"') do taskkill /F /T /PID %%p >nul 2>&1
ping 127.0.0.1 -n 2 >nul

echo [INFO] Iniciando o Backend FastAPI (porta 8000)...
start "CellFlow Data Studio - Backend" cmd /k "cd /d "%~dp0" && title CellFlow Data Studio - Backend :8000 && set PYTHONPATH=. && "%PYTHON_EXE%" -m src.core.infrastructure.web.main"

echo [INFO] Iniciando o Frontend Vite (porta 5173)...
start "CellFlow Data Studio - Frontend" cmd /k "cd /d "%~dp0ui" && title CellFlow Data Studio - Frontend :5173 && npm run dev"

echo.
echo [INFO] Aguardando inicializacao dos servicos...
timeout /t 3 /nobreak >nul

echo [INFO] Abrindo o Studio no navegador: http://localhost:5173
start http://localhost:5173

echo.
echo ================================================================
echo  CellFlow Data Studio iniciado com sucesso!
echo  - Studio UI:   http://localhost:5173
echo  - Swagger API: http://localhost:8000/docs
echo ================================================================
echo.
echo Voce pode fechar esta janela agora (os servicos continuam rodando).
pause
