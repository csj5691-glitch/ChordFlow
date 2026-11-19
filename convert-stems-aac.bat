@echo off
setlocal enabledelayedexpansion
rem Convertit les stems WAV de H: en AAC 256 kb/s .m4a directement dans OneDrive.
rem Les WAV d'origine ne sont jamais modifies ni supprimes.
set "SRC=H:\chordflow-stems"
set "DEST=%OneDrive%\chordflow-stems-aac"

if "%OneDrive%"=="" goto PAS_ONEDRIVE
if not exist "%SRC%" goto PAS_SOURCE
where ffmpeg >nul 2>&1
if errorlevel 1 goto PAS_FFMPEG
if not exist "%DEST%" mkdir "%DEST%"

echo Conversion AAC 256 kb/s
echo Source : %SRC%
echo Cible  : %DEST%
set "NB=0"

for /d %%S in ("%SRC%\*") do (
  set "ID=%%~nxS"
  set "DSTDIR=%DEST%\!ID!\stems"
  if not exist "!DSTDIR!" mkdir "!DSTDIR!"
  for %%F in ("%%S\stems\*.wav") do (
    if exist "%%F" (
      set "STEM=%%~nF"
      if not exist "!DSTDIR!\!STEM!.m4a" (
        echo Conversion !ID! / !STEM!
        ffmpeg -hide_banner -loglevel error -y -i "%%F" -map 0:a:0 -vn -c:a aac -b:a 256k "!DSTDIR!\!STEM!.m4a"
        if errorlevel 1 echo ECHEC !ID! / !STEM!
        set /a NB+=1
      )
    )
  )
)

echo Termine. !NB! nouveau(x) fichier(s) cree(s).
pause
exit /b 0

:PAS_ONEDRIVE
echo Dossier OneDrive introuvable.
pause
exit /b 1

:PAS_SOURCE
echo Source introuvable : %SRC%
pause
exit /b 1

:PAS_FFMPEG
echo ffmpeg introuvable dans le PATH.
pause
exit /b 1
