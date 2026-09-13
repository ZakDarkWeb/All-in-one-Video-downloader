import os
import sys
import time
import socket
import threading
import uvicorn
import webview
from pathlib import Path

# Fix path when running as PyInstaller executable
if getattr(sys, "frozen", False):
    os.chdir(sys._MEIPASS)

from main import app, DATA_DIR


def find_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def start_server(port):
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=port,
        log_level="warning",
        access_log=False
    )


def wait_for_server(port, timeout=10.0):
    start_time = time.time()
    while time.time() - start_time < timeout:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                return True
        except OSError:
            time.sleep(0.1)
    return False


def get_port():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(("127.0.0.1", 8000))
            return 8000
    except OSError:
        return find_free_port()


def main():
    port = get_port()
    
    server_thread = threading.Thread(
        target=start_server,
        args=(port,),
        daemon=True
    )
    server_thread.start()

    if not wait_for_server(port):
        print("Server start hone mein issue aaya.")
        sys.exit(1)

    url = f"http://127.0.0.1:{port}"

    # Create Native Desktop App Window
    window = webview.create_window(
        title="ZDownloader PRO • By Basit",
        url=url,
        width=1220,
        height=840,
        min_size=(900, 650),
        text_select=True,
        zoomable=True
    )

    webview.start()
    sys.exit(0)


if __name__ == "__main__":
    main()
