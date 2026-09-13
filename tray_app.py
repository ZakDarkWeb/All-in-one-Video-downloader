"""
ZDownloader PRO — Windows System Tray Companion
Sits near the Windows clock, manages the FastAPI backend silently,
and provides instant 1-click access to Web App and Downloads.
"""

import os
import sys
import time
import re
import subprocess
import threading
import webbrowser
import urllib.parse
from pathlib import Path
from PIL import Image, ImageDraw
import pystray
from pystray import MenuItem as item, Menu

APP_DIR = Path(__file__).resolve().parent
ICON_PATH = APP_DIR / "extension" / "icons" / "icon128.png"
API_URL = "http://127.0.0.1:8000"

backend_process = None
is_running = True
server_status_text = "Checking status..."
clipboard_monitor_active = True
last_clipboard_url = ""

CREATE_NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0

# Video platforms regex for clipboard URL detection
VIDEO_URL_PATTERN = re.compile(
    r"https?://(?:www\.)?(?:"
    r"youtube\.com/watch\?|youtu\.be/|youtube\.com/shorts/|youtube\.com/live/|"
    r"instagram\.com/(?:p|reel|tv)/|"
    r"tiktok\.com/|"
    r"twitter\.com/\w+/status/|x\.com/\w+/status/|"
    r"pinterest\.com/pin/|pin\.it/|"
    r"reddit\.com/r/|v\.redd\.it/|"
    r"facebook\.com/(?:watch|reel|\w+/videos)/|fb\.watch/|"
    r"dailymotion\.com/video/|vimeo\.com/\d+|twitch\.tv/|threads\.net/@\w+/post/|"
    r"bilibili\.com/video/|soundcloud\.com/"
    r")[^\s'\"<>]+",
    re.IGNORECASE
)


def get_clipboard_text() -> str:
    """Safely retrieves text from Windows clipboard using standard ctypes."""
    if sys.platform != "win32":
        return ""
    try:
        import ctypes
        user32 = ctypes.windll.user32
        kernel32 = ctypes.windll.kernel32

        if not user32.OpenClipboard(None):
            return ""
        try:
            CF_UNICODETEXT = 13
            handle = user32.GetClipboardData(CF_UNICODETEXT)
            if not handle:
                return ""
            kernel32.GlobalLock.restype = ctypes.c_wchar_p
            ptr = kernel32.GlobalLock(handle)
            if not ptr:
                return ""
            text = str(ptr)
            kernel32.GlobalUnlock(handle)
            return text.strip()
        finally:
            user32.CloseClipboard()
    except Exception:
        return ""


def find_video_url(text: str) -> str:
    """Extracts first supported media URL from text."""
    if not text:
        return ""
    m = VIDEO_URL_PATTERN.search(text)
    return m.group(0) if m else ""


def create_fallback_icon():
    """Generates a sleek cyber gradient icon if PNG is missing."""
    img = Image.new("RGBA", (64, 64), color=(0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    # Circle with cyan/violet gradient feel
    draw.ellipse([4, 4, 60, 60], fill=(13, 17, 23), outline=(0, 212, 255), width=3)
    # Z letter in cyan
    draw.polygon([(20, 18), (44, 18), (22, 46), (44, 46), (44, 42), (28, 42), (44, 22), (20, 22)], fill=(0, 212, 255))
    return img


def get_icon_image():
    """Loads extension icon or fallback."""
    if ICON_PATH.exists():
        try:
            return Image.open(ICON_PATH).convert("RGBA")
        except Exception:
            pass
    return create_fallback_icon()


def is_backend_alive():
    """Checks if FastAPI backend is responding on port 8000."""
    try:
        import urllib.request
        req = urllib.request.Request(f"{API_URL}/api/status", headers={"User-Agent": "ZDownloader-Tray"})
        with urllib.request.urlopen(req, timeout=1.5) as resp:
            return resp.status == 200
    except Exception:
        return False


def start_backend():
    """Starts backend silently if not already running."""
    global backend_process
    if is_backend_alive():
        return

    # Use pythonw if available, else python with CREATE_NO_WINDOW
    py_exec = sys.executable
    if py_exec.lower().endswith("python.exe"):
        pyw = Path(py_exec).parent / "pythonw.exe"
        if pyw.exists():
            py_exec = str(pyw)

    cmd = [py_exec, "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
    try:
        backend_process = subprocess.Popen(
            cmd,
            cwd=str(APP_DIR),
            creationflags=CREATE_NO_WINDOW,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )
    except Exception as e:
        print(f"Failed to launch backend: {e}")


def stop_backend():
    """Terminates backend process cleanly."""
    global backend_process
    if backend_process:
        try:
            backend_process.terminate()
            backend_process.wait(timeout=2)
        except Exception:
            try:
                backend_process.kill()
            except Exception:
                pass
        backend_process = None

    # Also kill any leftover uvicorn on port 8000 if spawned by this app
    if sys.platform == "win32":
        try:
            out = subprocess.check_output("netstat -ano | findstr :8000", shell=True).decode()
            for line in out.strip().splitlines():
                if "LISTENING" in line:
                    parts = line.strip().split()
                    pid = parts[-1]
                    subprocess.run(f"taskkill /F /PID {pid}", shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            pass


def restart_backend(icon, item):
    """Restarts the backend engine."""
    stop_backend()
    time.sleep(1)
    start_backend()


def open_web_app(icon, item):
    """Opens the Cyberpunk Web App in the default browser."""
    if not is_backend_alive():
        start_backend()
        time.sleep(1.5)
    webbrowser.open(API_URL)


def open_downloads_folder(icon, item):
    """Opens user's ZDownloader downloads folder."""
    opened = False
    try:
        import urllib.request
        req = urllib.request.Request(f"{API_URL}/api/open-downloads", data=b"{}", headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=2) as resp:
            if resp.status == 200:
                opened = True
    except Exception:
        pass

    if not opened:
        default_dir = Path.home() / "Downloads" / "ZDownloader"
        default_dir.mkdir(parents=True, exist_ok=True)
        if sys.platform == "win32":
            os.startfile(str(default_dir))
        else:
            subprocess.run(["open" if sys.platform == "darwin" else "xdg-open", str(default_dir)])


def get_clipboard_action_label(item):
    """Returns dynamic label showing detected URL."""
    if last_clipboard_url:
        short = last_clipboard_url if len(last_clipboard_url) <= 32 else last_clipboard_url[:29] + "..."
        return f"📥 Download Link ({short})"
    return "📥 Paste & Download URL"


def open_with_clipboard_url(icon, item):
    """Opens Web UI populated with clipboard video link."""
    target_url = last_clipboard_url
    if not target_url:
        target_url = find_video_url(get_clipboard_text())

    if not is_backend_alive():
        start_backend()
        time.sleep(1.5)

    if target_url:
        webbrowser.open(f"{API_URL}?url={urllib.parse.quote(target_url, safe='')}")
    else:
        webbrowser.open(API_URL)


def toggle_clipboard_monitor(icon, item):
    """Toggles clipboard listener on/off."""
    global clipboard_monitor_active
    clipboard_monitor_active = not clipboard_monitor_active


def get_status_label(item):
    """Returns dynamic label for the status menu item."""
    if is_backend_alive():
        return "🟢 Status: Active (Port 8000)"
    return "🔴 Status: Offline (Click to Start)"


def status_click(icon, item):
    """Clicks status item to start/check backend."""
    if not is_backend_alive():
        start_backend()


def exit_app(icon, item):
    """Exits the tray application and shuts down backend."""
    global is_running
    is_running = False
    stop_backend()
    icon.stop()


def status_monitor_thread(icon):
    """Background loop that updates tooltip with server status."""
    while is_running:
        alive = is_backend_alive()
        icon.title = f"ZDownloader PRO — {'🟢 Online' if alive else '🔴 Offline'}"
        time.sleep(4)


def clipboard_monitor_thread(icon):
    """Background thread that monitors clipboard for media links."""
    global last_clipboard_url
    last_seen_raw = ""
    while is_running:
        try:
            if clipboard_monitor_active:
                current_text = get_clipboard_text()
                if current_text and current_text != last_seen_raw:
                    last_seen_raw = current_text
                    video_url = find_video_url(current_text)
                    if video_url and video_url != last_clipboard_url:
                        last_clipboard_url = video_url
                        try:
                            # Show balloon notification
                            icon.notify(
                                title="ZDownloader PRO",
                                message=f"Video URL detected! Click tray or open Web App:\n{video_url[:48]}..."
                            )
                        except Exception:
                            pass
        except Exception:
            pass
        time.sleep(1.5)


def main():
    # 1. Ensure backend is running
    start_backend()

    # 2. Build tray menu
    menu = Menu(
        item("🌐 Open Web App", open_web_app, default=True),
        item(get_clipboard_action_label, open_with_clipboard_url),
        item("📁 Open Downloads Folder", open_downloads_folder),
        Menu.SEPARATOR,
        item("📋 Monitor Clipboard", toggle_clipboard_monitor, checked=lambda item: clipboard_monitor_active),
        item(get_status_label, status_click),
        item("🔄 Restart Engine", restart_backend),
        Menu.SEPARATOR,
        item("❌ Exit ZDownloader", exit_app)
    )

    icon_image = get_icon_image()
    tray_icon = pystray.Icon("ZDownloaderPRO", icon_image, "ZDownloader PRO", menu)

    # 3. Start background threads
    t_status = threading.Thread(target=status_monitor_thread, args=(tray_icon,), daemon=True)
    t_status.start()

    t_clip = threading.Thread(target=clipboard_monitor_thread, args=(tray_icon,), daemon=True)
    t_clip.start()

    # 4. Run tray icon event loop
    try:
        tray_icon.run()
    except KeyboardInterrupt:
        exit_app(tray_icon, None)


if __name__ == "__main__":
    main()

