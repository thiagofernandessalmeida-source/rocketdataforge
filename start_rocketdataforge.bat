@echo off
title RocketDataForge - Launcher

echo ================================================================
echo          ROCKETDATAFORGE - STUDIO DE ENGENHARIA DE DADOS
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

echo [INFO] Iniciando o Backend FastAPI (porta 8000)...
start "RocketDataForge - Backend" cmd /k "cd /d "%~dp0" && title RocketDataForge - Backend :8000 && set PYTHONPATH=. && "%PYTHON_EXE%" -m src.core.infrastructure.web.main"

echo [INFO] Iniciando o Frontend Vite (porta 5173)...
start "RocketDataForge - Frontend" cmd /k "cd /d "%~dp0ui" && title RocketDataForge - Frontend :5173 && npm run dev"

echo.
echo [INFO] Aguardando inicializacao dos servicos...
timeout /t 3 /nobreak >nul

echo [INFO] Abrindo o Studio no navegador: http://localhost:5173
start http://localhost:5173

echo.
echo ================================================================
echo  RocketDataForge iniciado com sucesso!
echo  - Studio UI:   http://localhost:5173
echo  - Swagger API: http://localhost:8000/docs
echo ================================================================
echo.
echo Voce pode fechar esta janela agora (os servicos continuam rodando).
pause
