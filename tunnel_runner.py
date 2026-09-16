import subprocess
import re
import time
import os
import sys

# Ensure UTF-8 output
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

URL_FILE = os.path.join(os.path.dirname(__file__), "tunnel_url.txt")

def start_tunnel():
    cmd = ["cloudflared.exe", "tunnel", "--url", "http://localhost:8000"]
    print("Starting Cloudflare Tunnel...")
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="ignore", bufsize=1)
    
    tunnel_url = None
    for line in proc.stdout:
        # Check for trycloudflare.com URL
        match = re.search(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com", line)
        if match:
            tunnel_url = match.group(0)
            with open(URL_FILE, "w", encoding="utf-8") as f:
                f.write(tunnel_url)
            print(f"[TUNNEL_ONLINE] {tunnel_url}")
            sys.stdout.flush()
            break

    # Keep running
    proc.wait()

if __name__ == "__main__":
    start_tunnel()
