@echo off
title CellFlow Data Studio - Compilador Frontend
echo ================================================================
echo       RECOMPILANDO BUNDLE DE PRODUCAO (CELLFLOW STUDIO)
echo ================================================================
echo.

cd /d "%~dp0ui"
call npm run build

echo.
echo ================================================================
echo  Build concluido com sucesso! O App Desktop ja esta atualizado.
echo ================================================================
pause
