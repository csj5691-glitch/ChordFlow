@echo off
REM Start the Demucs stem separation service locally
REM Requires: pip install -r services\stems\requirements.txt

cd /d "%~dp0.."
python services\stems\server.py
