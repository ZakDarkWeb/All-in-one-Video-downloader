@echo off
echo Starting Video Downloader...

cd /d "%~dp0"

echo Browser will open automatically in 3 seconds...
start /B cmd /c "timeout /t 3 >nul & start http://localhost:8000"

echo Starting server...
python -m uvicorn main:app --host 127.0.0.1 --port 8000

pause
