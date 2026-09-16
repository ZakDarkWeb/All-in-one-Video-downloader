import subprocess
import re
import time
import os
import sys

LOG_FILE = os.path.join(os.path.dirname(__file__), "tunnel.log")
URL_FILE = os.path.join(os.path.dirname(__file__), "tunnel_url.txt")

# Clear old log file
if os.path.exists(LOG_FILE):
    try:
        os.remove(LOG_FILE)
    except:
        pass

# Run cloudflared with --logfile
cmd = ["cloudflared.exe", "tunnel", "--url", "http://localhost:8000", "--logfile", LOG_FILE]
proc = subprocess.Popen(cmd)

print("cloudflared started with PID:", proc.pid)

tunnel_url = None
# Poll log file for the URL
for _ in range(30):
    time.sleep(1)
    if os.path.exists(LOG_FILE):
        try:
            with open(LOG_FILE, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
                match = re.search(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com", content)
                if match:
                    tunnel_url = match.group(0)
                    with open(URL_FILE, "w", encoding="utf-8") as out:
                        out.write(tunnel_url)
                    print("TUNNEL_URL_ONLINE:", tunnel_url)
                    break
        except:
            pass

# Wait on proc so it keeps running
proc.wait()
