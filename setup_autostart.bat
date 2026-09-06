@echo off
title ZDownloader - Enable Auto-Start
cd /d "%~dp0"

echo =======================================================
echo     ZDownloader PRO - Auto-Start Setup
echo =======================================================
echo.
echo [1/2] Setting up silent Auto-Start on Windows Boot...
set "TARGET=%~dp0run_silent_backend.vbs"
set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"

(
echo Set WshShell = CreateObject^("WScript.Shell"^)
echo WshShell.Run "wscript.exe ""%TARGET%""", 0, False
) > "%STARTUP_FOLDER%\ZDownloader_AutoStart.vbs"

echo        [OK] Added to Windows Startup successfully!
echo.
echo [2/2] Registering 1-Click Browser Launch Protocol (zdownloader://)...
reg add "HKCU\Software\Classes\zdownloader" /ve /d "URL:ZDownloader Protocol" /f >nul 2>&1
reg add "HKCU\Software\Classes\zdownloader" /v "URL Protocol" /d "" /f >nul 2>&1
reg add "HKCU\Software\Classes\zdownloader\shell\open\command" /ve /d "wscript.exe \"%TARGET%\"" /f >nul 2>&1

echo        [OK] Browser auto-launch protocol registered!
echo.
echo =======================================================
echo  SUCCESS: ZDownloader is now 100%% AUTOMATIC!
echo  - Every time your PC turns on, the backend starts silently.
echo  - If offline, the Chrome Extension can wake it up in 1-click.
echo =======================================================
pause
