@echo off
title Install ZDownloader Dependencies
cd /d "%~dp0"
echo ====================================================
echo   Installing ZDownloader Dependencies via pip...
echo ====================================================
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
echo.
echo ====================================================
echo   All dependencies installed successfully!
echo   You can now launch the app using 'start.bat' or 'start_app.bat'
echo ====================================================
pause
