@echo off
REM Service local de separation des stems (Demucs via ONNX).
REM Demarche : pip install -r services\stems\requirements.txt
REM Le service ne se relance pas tout seul s'il s'arrete (crash, manque de
REM memoire en pleine separation) : cette boucle le redemarre, avec un delai
REM pour eviter de spinner quand l'erreur est fatale (ex. dependances absentes).

cd /d "%~dp0"
set STEMS_PORT=8765

:run
echo [stems] demarrage du service sur le port %STEMS_PORT% (modele htdemucs, 4 pistes)...
python services\stems\server.py
echo.
echo [stems] service arrete (code %ERRORLEVEL%). Redemarrage dans 5 s...
timeout /t 5 /nobreak >nul
goto run
