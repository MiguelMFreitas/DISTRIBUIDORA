@echo off
REM ==================================================================
REM  Impressao automatica dos pedidos - Distribuidora
REM  Abre um Chrome separado, que imprime direto na impressora padrao
REM  do Windows (deixe a ELGIN i9 como padrao), sem perguntar nada.
REM  O Chrome normal continua funcionando ao mesmo tempo (romaneio).
REM ==================================================================

set SITE=https://distribuidora-79of.vercel.app/imprimir/automatica
set PERFIL=%LOCALAPPDATA%\ChromePedidosAutomaticos

set CHROME=
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe
if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set CHROME=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe

if "%CHROME%"=="" (
  echo Nao encontrei o Google Chrome neste computador.
  echo Instale o Chrome e tente de novo.
  pause
  exit /b 1
)

start "" "%CHROME%" --kiosk-printing --user-data-dir="%PERFIL%" --no-first-run --disable-background-timer-throttling --new-window "%SITE%"
