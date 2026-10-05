@echo off
REM Service local de separation des stems (Demucs via ONNX).
REM Demarche : pip install -r services\stems\requirements.txt
REM Le service ne se relance pas tout seul s'il s'arrete (crash, manque de
REM memoire en pleine separation) : cette boucle le redemarre, avec un delai
REM pour eviter de spinner quand l'erreur est fatale (ex. dependances absentes).
REM Si un service ecoute deja sur le port, le script se termine sans boucle.

cd /d "%~dp0"
set STEMS_PORT=8765

:run
echo [stems] demarrage du service sur le port %STEMS_PORT% (modele htdemucs, 4 pistes)...
python services\stems\server.py
set CODE=%ERRORLEVEL%
if "%CODE%"=="0" (
  echo.
  echo [stems] rien a faire - le service est deja lance ou a ete arrete proprement.
  goto :fin
)
echo.
echo [stems] service arrete ^(code %CODE%^). Redemarrage dans 5 s...
timeout /t 5 /nobreak >nul
goto run

:fin
echo.
pause
