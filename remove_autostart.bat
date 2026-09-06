@echo off
title ZDownloader - Disable Auto-Start
cd /d "%~dp0"

echo Removing ZDownloader from Windows Startup...
del /f /q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\ZDownloader_AutoStart.vbs" >nul 2>&1
reg delete "HKCU\Software\Classes\zdownloader" /f >nul 2>&1

echo.
echo [OK] Auto-Start and browser auto-launch protocol have been removed.
echo.
pause
