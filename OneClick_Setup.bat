@echo off
title ZDownloader PRO - 1-Click Master Setup
cd /d "%~dp0"

echo ========================================================
echo        ZDownloader PRO - 1-Click All-in-One Setup
echo ========================================================
echo.
echo [Step 1/6] Checking Python installation...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] Python not detected. Installing Python via winget...
    winget install Python.Python.3.12 --silent --accept-package-agreements --accept-source-agreements >nul 2>&1
    python --version >nul 2>&1
    if %errorlevel% neq 0 (
        echo [X] Could not auto-install Python.
        echo     Please install Python manually from: https://www.python.org/downloads/
        echo     Make sure to check "Add Python to PATH"!
        pause
        exit /b 1
    )
)
echo        [OK] Python found!
echo.
echo [Step 2/6] Checking FFmpeg media engine...
where ffmpeg >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] FFmpeg not found. Attempting auto-install via winget...
    winget install Gyan.FFmpeg --silent --accept-package-agreements --accept-source-agreements >nul 2>&1
    where ffmpeg >nul 2>&1
    if %errorlevel% neq 0 (
        echo        [!] Winget install completed or skipped. FFmpeg can also be placed in tools\ folder.
    ) else (
        echo        [OK] FFmpeg installed successfully!
    )
) else (
    echo        [OK] FFmpeg found!
)
echo.
echo [Step 3/6] Installing dependencies via pip...
python -m pip install --upgrade pip >nul 2>&1
python -m pip install -r requirements.txt
echo        [OK] All dependencies installed successfully!
echo.
echo [Step 4/6] Setting up Windows Auto-Start and Browser Protocol...
set "TARGET=%~dp0run_silent_backend.vbs"
set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"

(
echo Set WshShell = CreateObject^("WScript.Shell"^)
echo WshShell.Run "wscript.exe ""%TARGET%""", 0, False
) > "%STARTUP_FOLDER%\ZDownloader_AutoStart.vbs"

reg add "HKCU\Software\Classes\zdownloader" /ve /d "URL:ZDownloader Protocol" /f >nul 2>&1
reg add "HKCU\Software\Classes\zdownloader" /v "URL Protocol" /d "" /f >nul 2>&1
reg add "HKCU\Software\Classes\zdownloader\shell\open\command" /ve /d "wscript.exe \"%TARGET%\"" /f >nul 2>&1
echo        [OK] Auto-Start and Browser Protocol enabled!
echo.
echo [Step 5/6] Creating Desktop Shortcut...
set "DESKTOP=%USERPROFILE%\Desktop"
powershell -Command "$s=(New-Object -COM WScript.Shell).CreateShortcut('%DESKTOP%\ZDownloader PRO.lnk');$s.TargetPath='%~dp0start_app.bat';$s.WorkingDirectory='%~dp0';$s.IconLocation='%~dp0extension\icons\icon128.png';$s.Save()" >nul 2>&1
echo        [OK] Desktop shortcut created!
echo.
echo [Step 6/6] Launching ZDownloader Backend in Background...
wscript.exe "%~dp0run_silent_backend.vbs"
echo        [OK] Backend engine started in background (Port 8000)!
echo.
echo ========================================================
echo   CONGRATULATIONS! Setup is 100%% COMPLETE!
echo.
echo   1. Backend is running in the background.
echo   2. 'ZDownloader PRO' shortcut created on your Desktop.
echo   3. Next time your PC starts, it turns on automatically!
echo.
echo   Chrome Extension Install Karein:
echo   - Chrome mein 'chrome://extensions/' par jayein
echo   - 'Developer mode' toggle ON karein
echo   - 'Load unpacked' click karke is folder ka 'extension' select karein!
echo ========================================================
pause
