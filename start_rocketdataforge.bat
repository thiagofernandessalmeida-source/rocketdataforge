@echo off

echo Executando o primeiro processo...
call "C:\Natura\PYTHON\rocketdataforge\build_app.bat"

if %ERRORLEVEL% NEQ 0 (
    echo ERRO: O primeiro processo terminou com erro.
    pause
    exit /b %ERRORLEVEL%
)

echo Primeiro processo finalizado com sucesso.
echo Executando o segundo processo...

call "C:\Natura\PYTHON\rocketdataforge\start_desktop.bat"

echo.
echo Processamento concluido.
pause