@echo off
rem Sauvegarde des stems dans OneDrive avec Robocopy, deja present dans Windows.
setlocal
set "SRC=H:\chordflow-stems"
set "DST=%OneDrive%\chordflow-stems"

if "%OneDrive%"=="" goto PAS_ONEDRIVE
if not exist "%SRC%" goto PAS_SOURCE
if not exist "%DST%" mkdir "%DST%"

echo Copie de %SRC% vers %DST%
robocopy "%SRC%" "%DST%" /E /COPY:DAT /R:1 /W:1 /MT:4 /NP /NFL /NDL /NJH /NJS /LOG+:"%TEMP%\chordflow-onedrive-backup.log"
if errorlevel 8 goto ERREUR
echo OK - les stems sont dans OneDrive, la synchro se fait toute seule.
goto FIN

:PAS_ONEDRIVE
echo Dossier OneDrive introuvable.
goto FIN

:PAS_SOURCE
echo Source introuvable : %SRC%
goto FIN

:ERREUR
echo ERREUR pendant la copie. Detail : %TEMP%\chordflow-onedrive-backup.log

:FIN
pause
