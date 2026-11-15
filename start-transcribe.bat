@echo off
REM Service local de transcription audio -> tablature (YIN pitch detection).
REM Demarche : pip install -r services\transcribe\requirements.txt
REM Le service ne se relance pas tout seul s'il s'arrete.

cd /d "%~dp0"
set TRANSCRIBE_PORT=8766

:run
echo [transcribe] demarrage du service sur le port %TRANSCRIBE_PORT%...
python services\transcribe\server.py
set CODE=%ERRORLEVEL%
if "%CODE%"=="0" (
  echo.
  echo [transcribe] rien a faire - le service est deja lance ou a ete arrete proprement.
  goto :fin
)
echo.
echo [transcribe] service arrete ^(code %CODE%^). Redemarrage dans 5 s...
timeout /t 5 /nobreak >nul
goto run

:fin
echo.
pause