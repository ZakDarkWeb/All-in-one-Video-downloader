@echo off
title ZDownloader Backend (Port 8000)
cd /d "%~dp0"
echo ========================================
echo   Starting ZDownloader Backend Server...
echo   URL: http://127.0.0.1:8000
echo   Press Ctrl+C to stop the server
echo ========================================
python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
pause
