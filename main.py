import os
import re
import shutil
import threading
import time
import uuid
import json
import sys
import asyncio
import requests
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlparse, quote
from concurrent.futures import ThreadPoolExecutor

import yt_dlp
from yt_dlp.version import __version__ as YTDLP_VERSION
import pinterest_downloader

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from pydantic import BaseModel

from db import init_db, db_insert_job, db_update_job, db_get_job, db_get_history, db_delete_record, db_delete_by_filename


# ------------------------------------------------------------
# Folders (Supports Standalone .EXE & Script mode)
# ------------------------------------------------------------

if getattr(sys, "frozen", False):
    # PyInstaller bundle temp folder
    BUNDLE_DIR = Path(sys._MEIPASS)
    # The directory where the .exe sits (for user's files)
    DATA_DIR = Path(sys.executable).resolve().parent
else:
    BUNDLE_DIR = Path(__file__).resolve().parent
    DATA_DIR = BUNDLE_DIR

FRONTEND_FILE = DATA_DIR / "frontend" / "index.html"
if not FRONTEND_FILE.exists():
    FRONTEND_FILE = BUNDLE_DIR / "frontend" / "index.html"

MOBILE_FILE = DATA_DIR / "frontend" / "mobile.html"
if not MOBILE_FILE.exists():
    MOBILE_FILE = BUNDLE_DIR / "frontend" / "mobile.html"

DOWNLOAD_DIR = Path.home() / "Downloads" / "ZDownloader"
COOKIE_DIR = DATA_DIR / "cookies"

DOWNLOAD_DIR.mkdir(exist_ok=True)
COOKIE_DIR.mkdir(exist_ok=True)

# Thread-safe in-memory jobs store and cancellation signals
JOBS = {}
JOBS_LOCK = threading.Lock()
CANCEL_EVENTS = {}


# ------------------------------------------------------------
# Tool path finders
# ------------------------------------------------------------

def find_aria2c():
    found = shutil.which("aria2c")
    if found:
        return found

    for base in [DATA_DIR, BUNDLE_DIR, DATA_DIR / "tools", BUNDLE_DIR / "tools"]:
        for cand in [base / "aria2c.exe", base / "bin" / "aria2c.exe"]:
            if cand.is_file():
                return str(cand)

    local_app_data = os.environ.get("LOCALAPPDATA", "")
    if local_app_data:
        winget_pkgs = Path(local_app_data) / "Microsoft" / "WinGet" / "Packages"
        for p in winget_pkgs.glob("aria2.aria2*/**/aria2c.exe"):
            if p.is_file():
                return str(p)

    return None


def find_ffmpeg():
    found = shutil.which("ffmpeg")
    if found:
        return found

    for base in [DATA_DIR, BUNDLE_DIR, DATA_DIR / "tools", BUNDLE_DIR / "tools"]:
        for cand in [base / "ffmpeg.exe", base / "bin" / "ffmpeg.exe"]:
            if cand.is_file():
                return str(cand)

    local_app_data = os.environ.get("LOCALAPPDATA", "")
    if local_app_data:
        winget_pkgs = Path(local_app_data) / "Microsoft" / "WinGet" / "Packages"
        for p in winget_pkgs.glob("**/ffmpeg.exe"):
            if p.is_file():
                return str(p)

    return None


# ------------------------------------------------------------
# Cookies
# ------------------------------------------------------------

COOKIE_FILES = {
    "youtube.com": "youtube.txt",
    "youtu.be": "youtube.txt",
    "instagram.com": "instagram.txt",
    "tiktok.com": "tiktok.txt",
    "facebook.com": "facebook.txt",
    "fb.watch": "facebook.txt",
    "twitter.com": "twitter.txt",
    "x.com": "twitter.txt",
    "snapchat.com": "snapchat.txt",
}


def get_cookie_file(url):
    try:
        host = urlparse(url).netloc.lower().split(":")[0]
    except Exception:
        host = ""

    for domain, filename in COOKIE_FILES.items():
        if host == domain or host.endswith("." + domain):
            cookie_path = COOKIE_DIR / filename

            if cookie_path.exists() and cookie_path.stat().st_size > 0:
                return str(cookie_path)

    generic_cookie = COOKIE_DIR / "cookies.txt"

    if generic_cookie.exists() and generic_cookie.stat().st_size > 0:
        return str(generic_cookie)

    return None


# ------------------------------------------------------------
# Helper functions
# ------------------------------------------------------------

def is_valid_url(url):
    try:
        parsed = urlparse(url)
        return parsed.scheme in ("http", "https") and bool(parsed.netloc)
    except Exception:
        return False


def safe_filename(title):
    title = title or "video"
    title = re.sub(r'[\\/*?:"<>|]', "", title)
    title = re.sub(r"\s+", " ", title).strip()
    return title[:100] or "video"


def get_unique_target_path(dest_dir: Path, title: str, ext: str) -> Path:
    safe = safe_filename(title)
    if not ext.startswith("."):
        ext = f".{ext}"
    base_path = dest_dir / f"{safe}{ext}"
    if not base_path.exists():
        return base_path
    counter = 1
    while True:
        candidate = dest_dir / f"{safe} ({counter}){ext}"
        if not candidate.exists():
            return candidate
        counter += 1


def rename_to_clean_title(file_path: Path, title: str, dest_dir: Path = None) -> Path:
    if not file_path or not file_path.exists():
        return file_path
    if dest_dir is None:
        dest_dir = DOWNLOAD_DIR
    try:
        dest_dir.mkdir(parents=True, exist_ok=True)
        ext = file_path.suffix.lower()
        target = get_unique_target_path(dest_dir, title, ext)
        if file_path.resolve() != target.resolve():
            file_path.rename(target)
            return target
        return file_path
    except Exception:
        return file_path


def clean_error(error):
    message = str(error)
    message = re.sub(r"\x1b\[[0-9;]*m", "", message)
    message = message.replace("ERROR: ", "").strip()

    lower_message = message.lower()

    if any(word in lower_message for word in [
        "login required",
        "sign in",
        "private",
        "cookies",
        "confirm you're not a bot"
    ]):
        message += (
            "\n\nCookies dobara Netscape format mein export karke "
            "'cookies' folder mein add karein."
        )

    if any(word in lower_message for word in [
        "unexpected_eof",
        "ssl",
        "timed out",
        "connection reset"
    ]):
        message += (
            "\n\nInternet/ISP connection issue hai. "
            "VPN on/off karke dobara try karein."
        )

    return message[:1000]


def format_bytes(size):
    if not size:
        return None

    size = float(size)

    for unit in ["B", "KB", "MB", "GB"]:
        if size < 1024:
            return f"{size:.1f} {unit}"
        size /= 1024

    return f"{size:.1f} TB"


def first_video(data):
    if not data:
        return {}

    while data.get("_type") in ("playlist", "multi_video"):
        entries = data.get("entries") or []
        selected = None

        for entry in entries:
            if entry:
                selected = entry
                break

        if not selected:
            break

        data = selected

    return data


def extract_snapchat(url):
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    }
    r = requests.get(url, headers=headers, allow_redirects=True, timeout=15)
    
    m = re.search(r'<script id="__NEXT_DATA__" type="application/json">({.*?})</script>', r.text, re.DOTALL)
    if not m:
        raise Exception("Snapchat video data nahi mili. Link check karein.")
        
    data = json.loads(m.group(1))
    
    def find_urls(obj, key):
        urls = []
        if isinstance(obj, dict):
            if key in obj and isinstance(obj[key], str) and obj[key].startswith("http"):
                urls.append(obj[key])
            for k, v in obj.items():
                urls.extend(find_urls(v, key))
        elif isinstance(obj, list):
            for item in obj:
                urls.extend(find_urls(item, key))
        return urls

    media_urls = find_urls(data, "mediaUrl")
    if not media_urls:
        raise Exception("Snapchat video link nahi mila.")
        
    media_url = media_urls[0]
    title = "Snapchat Video"
    
    pp = data.get("props", {}).get("pageProps", {})
    vm = pp.get("videoMetadata", {})
    if vm.get("name"):
        title = vm["name"]
        
    thumb = ""
    if vm.get("thumbnailUrl"):
        thumb = vm["thumbnailUrl"]
    else:
        preview = find_urls(data, "mediaPreviewUrl")
        if preview:
            thumb = preview[0]
        else:
            preview = find_urls(data, "value")
            for p in preview:
                if "thumb" in p.lower() or "preview" in p.lower():
                    thumb = p
                    break
                    
    return {
        "title": title,
        "thumbnail": thumb,
        "url": media_url
    }


def extract_pinterest(url):
    # Direct stream URL support
    if "v1.pinimg.com" in url or (url.endswith(".mp4") and "pinimg" in url) or ".m3u8" in url:
        return {
            "title": "Pinterest Video",
            "thumbnail": "",
            "url": url,
            "height": 720
        }

    # 1. Resolve pin.it short links
    if "pin.it" in url:
        m_code = re.search(r"pin\.it/([a-zA-Z0-9_-]+)", url)
        if m_code:
            try:
                head_res = requests.head(
                    f"https://api.pinterest.com/url_shortener/{m_code.group(1)}/redirect/",
                    headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"},
                    allow_redirects=False,
                    timeout=10,
                )
                loc = head_res.headers.get("Location") or head_res.headers.get("location")
                if loc and "pin" in loc:
                    url = loc
            except Exception:
                pass
        if "pin.it" in url:
            try:
                r = requests.get(url, allow_redirects=True, headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
                }, timeout=15)
                url = r.url
            except Exception:
                pass

    # 2. Extract clean Pin ID if present (handles slugs & query params)
    pin_id_match = re.search(r"(\d{10,})", url)
    target = pin_id_match.group(1) if pin_id_match else url

    from pinterest_downloader import Pinterest
    p = Pinterest()
    res = p.get_pin(target)
    if not res.get("ok"):
        if target != url:
            res = p.get_pin(url)
        if not res.get("ok"):
            raise Exception("Pinterest video nahi mili ya link ghalat hai.")

    pin = res.get("pin", {})
    video_data = pin.get("video")
    if not video_data or not video_data.get("formats"):
        raise Exception("Is Pinterest pin mein video nahi mili (shayad picture hai).")

    formats = video_data["formats"]
    best_stream = None
    for f in formats:
        if f.get("url", "").lower().endswith(".mp4"):
            best_stream = f["url"]
            break
    if not best_stream:
        best_stream = formats[-1]["url"]

    title = pin.get("title") or pin.get("description") or "Pinterest Video"
    thumb = video_data.get("poster") or (formats[0].get("thumbnail") if formats else "")
    height = formats[-1].get("height") or 720

    return {
        "title": title[:100],
        "thumbnail": thumb,
        "url": best_stream,
        "height": height
    }


def trim_file_if_needed(file_path, start_time, end_time, job_id):
    if not start_time and not end_time:
        return file_path

    file_path = Path(file_path)
    trimmed_file = file_path.parent / f"{job_id}_cut{file_path.suffix}"
    ff = find_ffmpeg() or "ffmpeg"

    trim_cmd = [ff, "-y"]
    if start_time:
        trim_cmd.extend(["-ss", str(start_time).strip()])
    if end_time:
        trim_cmd.extend(["-to", str(end_time).strip()])
    trim_cmd.extend(["-i", str(file_path), "-c", "copy", str(trimmed_file)])

    try:
        import subprocess
        res = subprocess.run(trim_cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if res.returncode == 0 and trimmed_file.exists() and trimmed_file.stat().st_size > 0:
            file_path.unlink(missing_ok=True)
            return trimmed_file
    except Exception:
        pass
    return file_path


# ------------------------------------------------------------
# yt-dlp options
# ------------------------------------------------------------

def base_options(url):
    options = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "playlist_items": "1",

        # High-speed parallel fragments & buffer
        "concurrent_fragment_downloads": 8,
        "buffersize": 1048576,        # 1MB buffer

        # Speed and retry settings
        "retries": 10,
        "fragment_retries": 10,
        "extractor_retries": 3,
        "file_access_retries": 3,
        "socket_timeout": 30,

        # IPv4 helps with some SSL/ISP problems
        "source_address": "0.0.0.0",

        # YouTube webpage SSL retries ko skip karta hai aur high-speed client spoof karta hai
        "extractor_args": {
            "youtube": {
                "player_client": ["android", "ios", "web"],
                "player_skip": ["webpage", "configs"]
            }
        },

        "http_headers": {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            )
        },
    }

    # Note: aria2c is intentionally avoided for yt-dlp stream downloads because
    # YouTube CDN drops multi-split connections causing exit code 19 and throttles speeds.
    # Native yt-dlp concurrent_fragment_downloads delivers maximum speed reliably.

    # FFmpeg location if detected
    ff_path = find_ffmpeg()
    if ff_path:
        options["ffmpeg_location"] = ff_path

    cookie_file = get_cookie_file(url)
    if cookie_file:
        options["cookiefile"] = cookie_file

    return options


# ------------------------------------------------------------
# Automatic cleanup (SAFE: NEVER deletes finished user files!)
# ------------------------------------------------------------

def cleanup_loop():
    while True:
        try:
            current_time = time.time()

            # ONLY clean up abandoned temporary or partial download fragments older than 3 hours
            # User's completed videos are NEVER deleted!
            TEMP_EXTENSIONS = {".part", ".ytdl", ".temp", ".tmp"}
            for file_path in DOWNLOAD_DIR.iterdir():
                try:
                    if not file_path.is_file():
                        continue

                    is_temp = (
                        file_path.suffix.lower() in TEMP_EXTENSIONS
                        or any(t in file_path.name.lower() for t in [".part", ".ytdl", ".temp"])
                    )

                    if is_temp and (current_time - file_path.stat().st_mtime > 10800):
                        file_path.unlink(missing_ok=True)

                except Exception:
                    pass

            # Prune memory jobs older than 6 hours (SQLite keeps long-term history)
            with JOBS_LOCK:
                old_jobs = [
                    job_id for job_id, job in JOBS.items()
                    if current_time - job.get("created", current_time) > 21600
                    and job.get("status") in ("done", "error", "cancelled")
                ]
                for job_id in old_jobs:
                    JOBS.pop(job_id, None)
                    CANCEL_EVENTS.pop(job_id, None)

        except Exception:
            pass

        time.sleep(600)


@asynccontextmanager
async def lifespan(app):
    init_db(DATA_DIR)
    threading.Thread(target=cleanup_loop, daemon=True).start()

    aria2_exe = find_aria2c()
    if aria2_exe:
        aria2_dir = str(Path(aria2_exe).parent)
        if aria2_dir not in os.environ.get("PATH", ""):
            os.environ["PATH"] = aria2_dir + os.pathsep + os.environ.get("PATH", "")

    ff_exe = find_ffmpeg()
    if ff_exe:
        ff_dir = str(Path(ff_exe).parent)
        if ff_dir not in os.environ.get("PATH", ""):
            os.environ["PATH"] = ff_dir + os.pathsep + os.environ.get("PATH", "")

    yield


# ------------------------------------------------------------
# FastAPI app
# ------------------------------------------------------------

app = FastAPI(
    title="Local Video Downloader",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ------------------------------------------------------------
# Request models
# ------------------------------------------------------------

class URLRequest(BaseModel):
    url: str


class BulkInfoRequest(BaseModel):
    urls: list[str]


class DownloadRequest(BaseModel):
    url: str
    quality: str = "best"
    audio_only: bool = False
    audio_bitrate: str = "320k"
    start_time: str = None
    end_time: str = None
    turbo: bool = True


class SubtitleRequest(BaseModel):
    url: str
    lang: str = "en"


class CookieSyncRequest(BaseModel):
    domain: str = ""
    cookies: list[dict] = []
    netscape: str = ""


# ------------------------------------------------------------
# Frontend
# ------------------------------------------------------------

@app.get("/", response_class=HTMLResponse)
def homepage(request: Request, desktop: bool = False, mobile: bool = False):
    ua = request.headers.get("user-agent", "").lower()
    is_mobile = any(m in ua for m in ["mobile", "android", "iphone", "ipad", "ipod", "webos", "blackberry"])

    if (is_mobile or mobile) and not desktop:
        if MOBILE_FILE.exists():
            return HTMLResponse(MOBILE_FILE.read_text(encoding="utf-8"))

    if not FRONTEND_FILE.exists():
        return HTMLResponse(
            "<h2>frontend/index.html file nahi mili.</h2>",
            status_code=500
        )

    return HTMLResponse(
        FRONTEND_FILE.read_text(encoding="utf-8")
    )


@app.get("/mobile", response_class=HTMLResponse)
def mobile_view():
    if MOBILE_FILE.exists():
        return HTMLResponse(MOBILE_FILE.read_text(encoding="utf-8"))
    if FRONTEND_FILE.exists():
        return HTMLResponse(FRONTEND_FILE.read_text(encoding="utf-8"))
    return HTMLResponse("<h2>Mobile file not found.</h2>", status_code=500)


@app.get("/manifest.json")
def pwa_manifest():
    manifest_file = DATA_DIR / "frontend" / "manifest.json"
    if manifest_file.exists():
        return FileResponse(manifest_file, media_type="application/manifest+json")
    return HTMLResponse("{}", media_type="application/json")


@app.get("/sw.js")
def pwa_service_worker():
    sw_file = DATA_DIR / "frontend" / "sw.js"
    if sw_file.exists():
        return FileResponse(sw_file, media_type="application/javascript")
    return HTMLResponse("", media_type="application/javascript")


@app.get("/icons/{filename}")
def pwa_icon(filename: str):
    icon_file = DATA_DIR / "frontend" / "icons" / Path(filename).name
    if icon_file.exists():
        return FileResponse(icon_file, media_type="image/png")
    raise HTTPException(status_code=404, detail="Icon not found")


# ------------------------------------------------------------
# Status
# ------------------------------------------------------------

@app.get("/api/status")
def api_status():
    cookies = []

    for cookie in COOKIE_DIR.glob("*.txt"):
        try:
            if cookie.stat().st_size > 0:
                cookies.append(cookie.name)
        except Exception:
            pass

    def get_local_ip():
        import socket
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(('10.255.255.255', 1))
            ip = s.getsockname()[0]
        except Exception:
            try:
                ip = socket.gethostbyname(socket.gethostname())
            except Exception:
                ip = '127.0.0.1'
        finally:
            s.close()
        return ip

    return {
        "ok": True,
        "yt_dlp": YTDLP_VERSION,
        "ytdlp_version": YTDLP_VERSION,
        "ffmpeg": bool(find_ffmpeg()),
        "deno": shutil.which("deno") is not None,
        "aria2c": bool(find_aria2c()),
        "cookies": cookies,
        "download_dir": str(DOWNLOAD_DIR),
        "local_ip": get_local_ip(),
    }


@app.get("/api/local-ip")
def api_local_ip():
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('10.255.255.255', 1))
        ip = s.getsockname()[0]
    except Exception:
        try:
            ip = socket.gethostbyname(socket.gethostname())
        except Exception:
            ip = '127.0.0.1'
    finally:
        s.close()
    return {
        "ok": True,
        "local_ip": ip,
        "port": 8000
    }


@app.post("/api/open-downloads")
def open_downloads():
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
    try:
        import subprocess
        subprocess.Popen(["explorer.exe", str(DOWNLOAD_DIR.resolve())])
        return {"ok": True}
    except Exception:
        try:
            os.startfile(str(DOWNLOAD_DIR))
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e)}


@app.post("/api/update-ytdlp")
async def update_ytdlp():
    """Auto-update yt-dlp to latest version"""
    import asyncio, subprocess, sys

    def do_update():
        try:
            proc = subprocess.run(
                [sys.executable, "-m", "pip", "install", "--upgrade", "yt-dlp"],
                capture_output=True, text=True, timeout=120
            )
            if proc.returncode == 0:
                return {"ok": True, "message": "yt-dlp updated! Restart the app to apply."}
            else:
                err = (proc.stderr or proc.stdout or "Unknown error")[:300]
                return {"ok": False, "message": err}
        except subprocess.TimeoutExpired:
            return {"ok": False, "message": "Update timed out (>2 min). Try again."}
        except Exception as ex:
            return {"ok": False, "message": str(ex)}

    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, do_update)
    result["old_version"] = YTDLP_VERSION
    return result


class SetDownloadDirRequest(BaseModel):
    path: str

@app.post("/api/set-download-dir")
def set_download_dir(req: SetDownloadDirRequest):
    """Change the download directory"""
    global DOWNLOAD_DIR
    try:
        new_dir = Path(req.path).expanduser().resolve()
        new_dir.mkdir(parents=True, exist_ok=True)
        DOWNLOAD_DIR = new_dir
        return {"ok": True, "download_dir": str(DOWNLOAD_DIR)}
    except Exception as e:
        return {"ok": False, "error": str(e)}




# ------------------------------------------------------------
# Get playlist information (Fast Flat Extraction)
# ------------------------------------------------------------

@app.post("/api/playlist")
def get_playlist_info(request: URLRequest):
    url = request.url.strip()

    if not is_valid_url(url):
        raise HTTPException(
            status_code=400,
            detail="Sahi playlist link paste karein."
        )

    opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": "in_playlist",
        "skip_download": True,
    }

    cookie_file = get_cookie_file(url)
    if cookie_file:
        opts["cookiefile"] = cookie_file

    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)

        if not info:
            raise Exception("Playlist information nahi mili.")

        entries = info.get("entries") or []
        if not entries and info.get("id"):
            entries = [info]

        videos = []
        for idx, e in enumerate(entries):
            if not e:
                continue
            vid = e.get("id")
            v_url = e.get("url") or (f"https://www.youtube.com/watch?v={vid}" if vid else "")
            if v_url and not v_url.startswith("http"):
                v_url = f"https://www.youtube.com/watch?v={v_url}"
            thumb = (e.get("thumbnails") and e["thumbnails"][-1].get("url")) or (f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg" if vid else "")
            videos.append({
                "index": idx + 1,
                "id": vid,
                "title": e.get("title") or f"Video #{idx+1}",
                "duration": e.get("duration"),
                "thumbnail": thumb,
                "url": v_url,
                "uploader": e.get("uploader") or e.get("channel") or ""
            })

        return {
            "ok": True,
            "title": info.get("title") or "YouTube Playlist",
            "uploader": info.get("uploader") or info.get("channel") or "Unknown",
            "total_videos": len(videos),
            "videos": videos
        }

    except Exception as error:
        raise HTTPException(
            status_code=400,
            detail=clean_error(error)
        )


# ------------------------------------------------------------
# Get video information
# ------------------------------------------------------------

@app.post("/api/info")
def get_video_info(request: URLRequest):
    url = request.url.strip()

    if not is_valid_url(url):
        raise HTTPException(
            status_code=400,
            detail="Sahi video link paste karein."
        )

    if "snapchat.com" in url.lower():
        try:
            snap_info = extract_snapchat(url)
            return {
                "title": snap_info["title"],
                "thumbnail": snap_info["thumbnail"],
                "duration": None,
                "uploader": "Snapchat",
                "platform": "Snapchat",
                "qualities": [
                    {"height": 720, "label": "720p", "size": None}
                ],
                "cookies_used": False,
            }
        except Exception as error:
            raise HTTPException(
                status_code=400,
                detail=clean_error(error)
            )

    if any(d in url.lower() for d in ["pinterest.com", "pin.it"]):
        try:
            pin_info = extract_pinterest(url)
            return {
                "title": pin_info["title"],
                "thumbnail": pin_info["thumbnail"],
                "duration": None,
                "uploader": "Pinterest",
                "platform": "Pinterest",
                "qualities": [
                    {"height": pin_info.get("height") or 720, "label": f"{pin_info.get('height') or 720}p", "size": None}
                ],
                "cookies_used": False,
            }
        except Exception as error:
            raise HTTPException(
                status_code=400,
                detail=clean_error(error)
            )

    options = base_options(url)
    options["skip_download"] = True

    try:
        with yt_dlp.YoutubeDL(options) as downloader:
            information = downloader.extract_info(
                url,
                download=False
            )

        information = first_video(information)

    except Exception as error:
        raise HTTPException(
            status_code=400,
            detail=clean_error(error)
        )

    sizes = {}

    for video_format in information.get("formats", []):
        video_codec = video_format.get("vcodec")
        height = video_format.get("height")

        if video_codec in (None, "none") or not height:
            continue

        try:
            height = int(height)
        except Exception:
            continue

        size = (
            video_format.get("filesize")
            or video_format.get("filesize_approx")
            or 0
        )

        sizes[height] = max(
            sizes.get(height, 0),
            size or 0
        )

    qualities = []

    for height in sorted(sizes.keys(), reverse=True):
        qualities.append({
            "height": height,
            "label": f"{height}p",
            "size": format_bytes(sizes[height]),
        })

    # Extract available subtitles / captions
    subs = list(set(list((information.get("subtitles") or {}).keys()) + list((information.get("automatic_captions") or {}).keys())))
    sub_langs = sorted([s for s in subs if len(s) <= 10])[:15]

    return {
        "title": information.get("title") or "Untitled video",
        "thumbnail": information.get("thumbnail"),
        "duration": information.get("duration"),
        "uploader": (
            information.get("uploader")
            or information.get("channel")
            or information.get("creator")
        ),
        "platform": (
            information.get("extractor_key")
            or information.get("extractor")
        ),
        "qualities": qualities,
        "subtitles": sub_langs,
        "cookies_used": bool(options.get("cookiefile")),
    }


# ------------------------------------------------------------
# Download worker
# ------------------------------------------------------------

def download_worker(job_id, url, quality, audio_only, start_time=None, end_time=None, audio_bitrate="320k", turbo=True):
    with JOBS_LOCK:
        job = JOBS.get(job_id, {})
    cancel_event = CANCEL_EVENTS.get(job_id)
    output_template = str(DOWNLOAD_DIR / f"{job_id}.%(ext)s")

    if cancel_event and cancel_event.is_set():
        with JOBS_LOCK:
            job.update({"status": "cancelled", "error": "Download cancelled by user", "speed": "", "eta": ""})
        db_update_job(job_id, status="cancelled", error="Cancelled by user")
        return

    if "snapchat.com" in url.lower():
        try:
            snap_info = extract_snapchat(url)
            media_url = snap_info["url"]
            
            r = requests.get(media_url, stream=True, timeout=20)
            total_size = int(r.headers.get('content-length', 0))
            downloaded = 0
            
            final_file = DOWNLOAD_DIR / f"{job_id}.mp4"
            with open(final_file, 'wb') as f:
                for chunk in r.iter_content(chunk_size=1048576):  # 1MB chunks
                    if cancel_event and cancel_event.is_set():
                        raise yt_dlp.utils.DownloadCancelled("Download cancelled by user")
                    if chunk:
                        f.write(chunk)
                        downloaded += len(chunk)
                        if total_size:
                            pct = round((downloaded / total_size) * 100, 1)
                            with JOBS_LOCK:
                                job.update({
                                    "status": "downloading",
                                    "progress": pct,
                                    "speed": "",
                                    "eta": "",
                                })
            
            if cancel_event and cancel_event.is_set():
                raise yt_dlp.utils.DownloadCancelled("Download cancelled by user")

            final_file = trim_file_if_needed(final_file, start_time, end_time, job_id)
            title = safe_filename(snap_info.get("title") or "Snapchat Video")
            final_file = rename_to_clean_title(final_file, title, DOWNLOAD_DIR)
            stat = final_file.stat()
            with JOBS_LOCK:
                job.update({
                    "status": "done",
                    "progress": 100,
                    "speed": "",
                    "eta": "",
                    "file": str(final_file),
                    "filename": final_file.name,
                    "title": title
                })
            db_update_job(
                job_id,
                status="done",
                progress=100,
                title=title,
                filename=final_file.name,
                file_path=str(final_file),
                raw_size=stat.st_size,
                file_size=format_bytes(stat.st_size),
                completed_at=time.time()
            )
            return
            
        except yt_dlp.utils.DownloadCancelled:
            for p in DOWNLOAD_DIR.glob(f"{job_id}.*"):
                try:
                    p.unlink(missing_ok=True)
                except Exception:
                    pass
            with JOBS_LOCK:
                job.update({"status": "cancelled", "error": "Download cancelled by user", "speed": "", "eta": ""})
            db_update_job(job_id, status="cancelled", error="Cancelled by user")
            return

        except Exception as error:
            err_msg = clean_error(error)
            with JOBS_LOCK:
                job.update({
                    "status": "error",
                    "error": err_msg,
                    "speed": "",
                    "eta": "",
                })
            db_update_job(job_id, status="error", error=err_msg)
            return

    if any(d in url.lower() for d in ["pinterest.com", "pin.it"]):
        try:
            import subprocess
            pin_info = extract_pinterest(url)
            stream_url = pin_info["url"]
            ff = find_ffmpeg() or "ffmpeg"
            title = safe_filename(pin_info["title"])

            if cancel_event and cancel_event.is_set():
                raise yt_dlp.utils.DownloadCancelled("Download cancelled by user")

            if audio_only:
                final_file = DOWNLOAD_DIR / f"{job_id}.mp3"
                with JOBS_LOCK:
                    job.update({"status": "downloading", "progress": 35, "speed": "Turbo", "eta": ""})
                cmd = [
                    ff, "-y",
                    "-i", stream_url,
                    "-vn",
                    "-c:a", "libmp3lame",
                    "-b:a", "192k",
                    str(final_file)
                ]
            else:
                final_file = DOWNLOAD_DIR / f"{job_id}.mp4"
                with JOBS_LOCK:
                    job.update({"status": "downloading", "progress": 35, "speed": "Turbo", "eta": ""})
                cmd = [
                    ff, "-y",
                    "-i", stream_url,
                    "-c", "copy",
                    "-bsf:a", "aac_adtstoasc",
                    str(final_file)
                ]

            with JOBS_LOCK:
                job.update({"status": "downloading", "progress": 75, "speed": "Merging", "eta": ""})
            subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

            if cancel_event and cancel_event.is_set():
                raise yt_dlp.utils.DownloadCancelled("Download cancelled by user")

            final_file = trim_file_if_needed(final_file, start_time, end_time, job_id)
            title = safe_filename(pin_info.get("title") or "Pinterest Video")
            final_file = rename_to_clean_title(final_file, title, DOWNLOAD_DIR)
            stat = final_file.stat()
            with JOBS_LOCK:
                job.update({
                    "status": "done",
                    "progress": 100,
                    "speed": "",
                    "eta": "",
                    "file": str(final_file),
                    "filename": final_file.name,
                    "title": title
                })
            db_update_job(
                job_id,
                status="done",
                progress=100,
                title=title,
                filename=final_file.name,
                file_path=str(final_file),
                raw_size=stat.st_size,
                file_size=format_bytes(stat.st_size),
                completed_at=time.time()
            )
            return

        except yt_dlp.utils.DownloadCancelled:
            for p in DOWNLOAD_DIR.glob(f"{job_id}.*"):
                try:
                    p.unlink(missing_ok=True)
                except Exception:
                    pass
            with JOBS_LOCK:
                job.update({"status": "cancelled", "error": "Download cancelled by user", "speed": "", "eta": ""})
            db_update_job(job_id, status="cancelled", error="Cancelled by user")
            return

        except Exception as error:
            err_msg = clean_error(error)
            with JOBS_LOCK:
                job.update({
                    "status": "error",
                    "error": err_msg,
                    "speed": "",
                    "eta": ""
                })
            db_update_job(job_id, status="error", error=err_msg)
            return

    def progress_hook(data):
        if cancel_event and cancel_event.is_set():
            raise yt_dlp.utils.DownloadCancelled("Download cancelled by user")

        if data.get("status") == "downloading":
            total = (
                data.get("total_bytes")
                or data.get("total_bytes_estimate")
                or 0
            )

            downloaded = data.get("downloaded_bytes") or 0

            with JOBS_LOCK:
                if total:
                    job["total_bytes"] = total
                    percentage = round((downloaded / total) * 100, 1)
                    percentage = max(0, min(percentage, 100))
                else:
                    percentage = job.get("progress", 0)

                speed = data.get("speed")
                eta = data.get("eta")

                info_dict = data.get("info_dict") or {}
                if info_dict:
                    if not job.get("title") and info_dict.get("title"):
                        job["title"] = safe_filename(info_dict.get("title"))
                    if not job.get("thumbnail") and info_dict.get("thumbnail"):
                        job["thumbnail"] = info_dict.get("thumbnail")

                job.update({
                    "status": "downloading",
                    "progress": percentage,
                    "speed": (
                        f"{format_bytes(speed)}/s"
                        if speed else ""
                    ),
                    "eta": (
                        f"{int(eta)}s"
                        if eta is not None else ""
                    ),
                })

        elif data.get("status") == "finished":
            with JOBS_LOCK:
                job.update({
                    "status": "processing",
                    "progress": 100,
                    "speed": "",
                    "eta": "",
                })

    def postprocessor_hook(data):
        if cancel_event and cancel_event.is_set():
            raise yt_dlp.utils.DownloadCancelled("Download cancelled by user")
        if data.get("status") == "started":
            with JOBS_LOCK:
                job["status"] = "processing"

    options = base_options(url)

    options.update({
        "outtmpl": output_template,
        "progress_hooks": [progress_hook],
        "postprocessor_hooks": [postprocessor_hook],
        "overwrites": True,
    })

    is_yt = any(y in url.lower() for y in ["youtube.com", "youtu.be"])
    aria2_path = find_aria2c()
    use_aria2 = bool(aria2_path and (turbo or not is_yt))

    if use_aria2:
        options["external_downloader"] = "aria2c"
        options["external_downloader_args"] = {
            "aria2c": [
                "-x", "16",
                "-s", "16",
                "-j", "16",
                "-k", "1M",
                "--min-split-size=1M",
                "--file-allocation=none",
                "--summary-interval=0"
            ]
        }

    if audio_only:
        options["format"] = (
            "bestaudio[ext=m4a]/bestaudio/best"
        )

        pref_q = audio_bitrate.replace("k", "").strip() if audio_bitrate else "320"
        options["writethumbnail"] = True
        options["postprocessors"] = [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": pref_q,
            },
            {
                "key": "FFmpegMetadata",
                "add_metadata": True,
            },
            {
                "key": "EmbedThumbnail",
                "already_have_thumbnail": False,
            }
        ]

    else:
        if quality == "best":
            options["format"] = (
                "bestvideo[ext=mp4]+bestaudio[ext=m4a]/"
                "bestvideo+bestaudio/"
                "best[ext=mp4]/best"
            )
        else:
            selected_height = int(quality)

            options["format"] = (
                f"bestvideo[height<={selected_height}][ext=mp4]"
                f"+bestaudio[ext=m4a]/"
                f"bestvideo[height<={selected_height}]"
                f"+bestaudio/"
                f"best[height<={selected_height}][ext=mp4]/"
                f"best[height<={selected_height}]/best"
            )

        options["merge_output_format"] = "mp4"

    monitor_stop = threading.Event()

    def aria2_progress_monitor():
        last_bytes = 0
        last_time = time.time()
        while not monitor_stop.wait(0.5):
            try:
                parts = [
                    f for f in DOWNLOAD_DIR.glob(f"{job_id}*")
                    if f.is_file() and (".part" in f.name or f.suffix in (".ytdl", ".temp"))
                ]
                if not parts:
                    continue
                cur_bytes = sum(f.stat().st_size for f in parts)
                now = time.time()
                dt = max(0.2, now - last_time)
                spd = max(0, (cur_bytes - last_bytes) / dt)
                last_bytes = cur_bytes
                last_time = now

                with JOBS_LOCK:
                    total = job.get("total_bytes") or 0
                    if total > 0:
                        pct = round((cur_bytes / total) * 100, 1)
                        job["progress"] = max(job.get("progress", 0), min(pct, 99.0))
                        if spd > 0:
                            eta_sec = max(0, int((total - cur_bytes) / spd))
                            job["eta"] = f"{eta_sec}s"
                    elif cur_bytes > 0:
                        p = job.get("progress", 5)
                        if p < 92:
                            job["progress"] = round(p + 1.5, 1)

                    if spd > 0:
                        job["speed"] = f"{format_bytes(spd)}/s"
            except Exception:
                pass

    if use_aria2:
        threading.Thread(target=aria2_progress_monitor, daemon=True).start()

    try:
        try:
            with yt_dlp.YoutubeDL(options) as downloader:
                information = downloader.extract_info(
                    url,
                    download=True
                )
        finally:
            monitor_stop.set()

        if cancel_event and cancel_event.is_set():
            raise yt_dlp.utils.DownloadCancelled("Download cancelled by user")

        information = first_video(information)
        if information:
            with JOBS_LOCK:
                if information.get("title"):
                    job["title"] = safe_filename(information.get("title"))
                if information.get("thumbnail"):
                    job["thumbnail"] = information.get("thumbnail")

        allowed_extensions = (
            [".mp3", ".m4a", ".opus", ".ogg", ".webm"]
            if audio_only
            else [".mp4", ".mkv", ".webm", ".mov", ".m4v"]
        )

        candidates = []

        for file_path in DOWNLOAD_DIR.glob(f"{job_id}.*"):
            if not file_path.is_file():
                continue

            if ".part" in file_path.name:
                continue

            if file_path.suffix.lower() in allowed_extensions:
                candidates.append(file_path)

        if not candidates:
            raise RuntimeError("Downloaded file nahi mili.")

        if audio_only:
            extension_priority = {
                ".mp3": 10,
                ".m4a": 8,
                ".opus": 6,
                ".ogg": 5,
                ".webm": 4,
            }
        else:
            extension_priority = {
                ".mp4": 10,
                ".mkv": 8,
                ".webm": 7,
                ".mov": 6,
                ".m4v": 5,
            }

        final_file = max(
            candidates,
            key=lambda file: (
                extension_priority.get(file.suffix.lower(), 0),
                file.stat().st_mtime
            )
        )

        final_file = trim_file_if_needed(final_file, start_time, end_time, job_id)

        title = safe_filename(
            information.get("title") or "video"
        )
        final_file = rename_to_clean_title(final_file, title, DOWNLOAD_DIR)
        stat = final_file.stat()

        with JOBS_LOCK:
            job.update({
                "status": "done",
                "progress": 100,
                "speed": "",
                "eta": "",
                "file": str(final_file),
                "filename": final_file.name,
                "title": title
            })
        db_update_job(
            job_id,
            status="done",
            progress=100,
            title=title,
            filename=final_file.name,
            file_path=str(final_file),
            raw_size=stat.st_size,
            file_size=format_bytes(stat.st_size),
            completed_at=time.time()
        )

    except yt_dlp.utils.DownloadCancelled:
        for p in DOWNLOAD_DIR.glob(f"{job_id}.*"):
            try:
                p.unlink(missing_ok=True)
            except Exception:
                pass
        with JOBS_LOCK:
            job.update({
                "status": "cancelled",
                "error": "Download cancelled by user",
                "speed": "",
                "eta": "",
            })
        db_update_job(job_id, status="cancelled", error="Cancelled by user")

    except Exception as error:
        err_msg = clean_error(error)
        with JOBS_LOCK:
            job.update({
                "status": "error",
                "error": err_msg,
                "speed": "",
                "eta": "",
            })
        db_update_job(job_id, status="error", error=err_msg)


# ------------------------------------------------------------
# Start download
# ------------------------------------------------------------

@app.post("/api/download")
def start_download(request: DownloadRequest):
    url = request.url.strip()

    if not is_valid_url(url):
        raise HTTPException(
            status_code=400,
            detail="Sahi video link paste karein."
        )

    quality = str(request.quality).strip().lower()

    if not request.audio_only and quality != "best":
        if not quality.isdigit():
            raise HTTPException(
                status_code=400,
                detail="Quality sahi nahi hai."
            )

        height = int(quality)

        if height < 100 or height > 10000:
            raise HTTPException(
                status_code=400,
                detail="Quality sahi nahi hai."
            )

    job_id = uuid.uuid4().hex

    with JOBS_LOCK:
        JOBS[job_id] = {
            "status": "starting",
            "progress": 0,
            "speed": "",
            "eta": "",
            "created": time.time(),
            "url": url,
            "quality": quality,
            "is_audio": request.audio_only,
        }
        CANCEL_EVENTS[job_id] = threading.Event()

    db_insert_job(job_id, url, quality, request.audio_only)

    worker = threading.Thread(
        target=download_worker,
        args=(
            job_id,
            url,
            quality,
            request.audio_only,
            request.start_time,
            request.end_time,
            request.audio_bitrate,
            request.turbo
        ),
        daemon=True
    )

    worker.start()

    return {
        "job_id": job_id
    }


# ------------------------------------------------------------
# Cancel download
# ------------------------------------------------------------

@app.post("/api/cancel/{job_id}")
def cancel_download(job_id: str):
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if not job:
            job = db_get_job(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Download job nahi mila.")

        event = CANCEL_EVENTS.get(job_id)
        if event:
            event.set()

        if job.get("status") in ("done", "error", "cancelled"):
            return {"ok": False, "message": f"Job already {job.get('status')}"}

        job.update({
            "status": "cancelled",
            "error": "Download cancelled by user",
            "speed": "",
            "eta": ""
        })
    db_update_job(job_id, status="cancelled", error="Cancelled by user")
    return {"ok": True, "message": "Download cancel kar di gayi hai."}


# ------------------------------------------------------------
# Real-Time SSE Progress Stream
# ------------------------------------------------------------

@app.get("/api/events/{job_id}")
async def stream_progress_events(job_id: str):
    async def event_generator():
        start_t = time.time()
        while time.time() - start_t < 900:  # Max 15 minutes stream
            with JOBS_LOCK:
                job = JOBS.get(job_id)
            if not job:
                job = db_get_job(job_id)
            if not job:
                yield f"event: error\ndata: {json.dumps({'error': 'Job not found'})}\n\n"
                break

            status = job.get("status")
            payload = {
                "status": status,
                "progress": job.get("progress", 0),
                "speed": job.get("speed", ""),
                "eta": job.get("eta", ""),
                "title": job.get("title", ""),
                "thumbnail": job.get("thumbnail", ""),
                "error": job.get("error", ""),
                "filename": job.get("filename", "")
            }
            yield f"data: {json.dumps(payload)}\n\n"

            if status in ("done", "error", "cancelled"):
                break

            await asyncio.sleep(0.35)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


# ------------------------------------------------------------
# 1-Click Cookie Sync from Chrome Extension
# ------------------------------------------------------------

@app.post("/api/sync-cookies")
def sync_cookies(req: CookieSyncRequest):
    domain = req.domain.strip().lower()
    netscape_lines = []

    if req.netscape.strip():
        raw = req.netscape.strip()
        if "\t" in raw:
            netscape_lines = raw.splitlines()
        else:
            # Parse raw cookie string or key=val format (e.g. sessionid=...; ds_user_id=...)
            netscape_lines.append("# Netscape HTTP Cookie File")
            clean_dom = domain if domain else "instagram.com"
            if not clean_dom.startswith("."):
                clean_dom = "." + clean_dom
            for item in raw.replace("\n", ";").split(";"):
                if "=" in item:
                    k, v = item.strip().split("=", 1)
                    if k and v:
                        exp = int(time.time() + 86400 * 365)
                        netscape_lines.append(f"{clean_dom}\tTRUE\t/\tTRUE\t{exp}\t{k.strip()}\t{v.strip()}")
                elif len(item.strip()) > 15:
                    # Raw session ID string passed directly!
                    exp = int(time.time() + 86400 * 365)
                    netscape_lines.append(f"{clean_dom}\tTRUE\t/\tTRUE\t{exp}\tsessionid\t{item.strip()}")
    elif req.cookies:
        netscape_lines.append("# Netscape HTTP Cookie File")
        netscape_lines.append("# Generated by ZDownloader Chrome Extension")
        for c in req.cookies:
            c_domain = c.get("domain", "")
            flag = "TRUE" if c_domain.startswith(".") else "FALSE"
            path = c.get("path", "/")
            secure = "TRUE" if c.get("secure") else "FALSE"
            exp = int(c.get("expirationDate") or time.time() + 86400 * 365)
            name = c.get("name", "")
            value = c.get("value", "")
            netscape_lines.append(f"{c_domain}\t{flag}\t{path}\t{secure}\t{exp}\t{name}\t{value}")

    if not netscape_lines:
        raise HTTPException(status_code=400, detail="Koi cookies data nahi mila.")

    matched_filename = "cookies.txt"
    for d, fname in COOKIE_FILES.items():
        if domain and (domain in d or d in domain):
            matched_filename = fname
            break

    target_file = COOKIE_DIR / matched_filename
    target_file.write_text("\n".join(netscape_lines), encoding="utf-8")
    return {
        "ok": True,
        "filename": matched_filename,
        "message": f"Cookies successfully synced to {matched_filename}!"
    }


# ------------------------------------------------------------
# 1-Click Engine Auto-Updater
# ------------------------------------------------------------

@app.post("/api/update-engine")
def update_engine():
    try:
        proc = subprocess.run(
            [sys.executable, "-m", "pip", "install", "--upgrade", "yt-dlp"],
            capture_output=True,
            text=True,
            timeout=90
        )
        import yt_dlp
        from importlib import reload
        reload(yt_dlp)
        new_ver = yt_dlp.version.__version__
        return {
            "ok": True,
            "version": new_ver,
            "message": f"Engine successfully updated to yt-dlp v{new_ver}!"
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ------------------------------------------------------------
# YouTube Playlist Batch Extractor
# ------------------------------------------------------------

class PlaylistRequest(BaseModel):
    url: str

@app.post("/api/playlist-extract")
def extract_playlist(req: PlaylistRequest):
    url = req.url.strip()
    if not is_valid_url(url):
        raise HTTPException(status_code=400, detail="Valid URL paste karein.")

    opts = {
        "extract_flat": "in_playlist",
        "skip_download": True,
        "quiet": True,
        "no_warnings": True,
    }
    cookie_file = get_cookie_file(url)
    if cookie_file:
        opts["cookiefile"] = cookie_file

    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
            if not info:
                raise HTTPException(status_code=400, detail="Playlist fetch nahi ho saki.")

            entries = info.get("entries") or [info]
            videos = []
            for entry in entries:
                if not entry:
                    continue
                v_url = entry.get("url") or f"https://www.youtube.com/watch?v={entry.get('id')}"
                if not str(v_url).startswith("http"):
                    v_url = f"https://www.youtube.com/watch?v={v_url}"
                videos.append({
                    "id": entry.get("id"),
                    "title": entry.get("title") or "Video",
                    "url": v_url,
                    "duration": entry.get("duration")
                })

            return {
                "ok": True,
                "title": info.get("title") or "Playlist",
                "count": len(videos),
                "videos": videos
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Playlist extract error: {str(e)}")


# ------------------------------------------------------------
# Subtitles Downloader
# ------------------------------------------------------------

@app.post("/api/subtitles")
def download_subtitles(req: SubtitleRequest):
    url = req.url.strip()
    lang = req.lang.strip() or "en"
    if not is_valid_url(url):
        raise HTTPException(status_code=400, detail="Sahi video URL paste karein.")

    opts = base_options(url)
    opts.update({
        "skip_download": True,
        "writesubtitles": True,
        "writeautomaticsub": True,
        "subtitleslangs": [lang],
        "subtitlesformat": "srt/vtt/best",
        "outtmpl": str(DOWNLOAD_DIR / "%(title)s.%(ext)s"),
    })

    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)
        title = info.get("title") or "video"
        safe = safe_filename(title)
        
        sub_files = list(DOWNLOAD_DIR.glob(f"{safe}*.srt")) + list(DOWNLOAD_DIR.glob(f"{safe}*.vtt"))
        fname = sub_files[-1].name if sub_files else f"{safe}.{lang}.srt"
        return {
            "ok": True,
            "filename": fname,
            "message": f"Subtitles saved to Downloads: {fname}"
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=clean_error(e))


# ------------------------------------------------------------
# Download progress (HTTP polling fallback)
# ------------------------------------------------------------

@app.get("/api/progress/{job_id}")
def get_progress(job_id: str):
    with JOBS_LOCK:
        job = JOBS.get(job_id)
    if not job:
        job = db_get_job(job_id)

    if not job:
        raise HTTPException(
            status_code=404,
            detail="Download job nahi mila."
        )

    return {
        key: value
        for key, value in job.items()
        if key not in ("file", "file_path")
    }


# ------------------------------------------------------------
# Send downloaded file
# ------------------------------------------------------------

@app.get("/api/file/{job_id}")
def get_downloaded_file(job_id: str):
    with JOBS_LOCK:
        job = JOBS.get(job_id)
    if not job:
        job = db_get_job(job_id)

    if not job or job.get("status") != "done":
        raise HTTPException(
            status_code=404,
            detail="File abhi ready nahi hai."
        )

    raw_path = job.get("file") or job.get("file_path", "")
    file_path = Path(raw_path) if raw_path else None

    if not file_path or not file_path.exists():
        raise HTTPException(
            status_code=404,
            detail="File delete ho chuki hai."
        )

    fname = job.get("filename") or file_path.name
    safe_ascii = re.sub(r'[^\w\.-]', '_', fname)
    quoted = quote(fname)
    media_type = "video/mp4" if fname.lower().endswith(".mp4") else ("audio/mpeg" if fname.lower().endswith(".mp3") else "application/octet-stream")
    return FileResponse(
        path=str(file_path),
        filename=fname,
        headers={"Content-Disposition": f'attachment; filename="{safe_ascii}"; filename*=UTF-8\'\'{quoted}'},
        media_type=media_type
    )


# ------------------------------------------------------------
# Bulk / Playlist Info Analyzer
# ------------------------------------------------------------

def _analyze_single_url(raw_url: str):
    url = raw_url.strip()
    if not is_valid_url(url):
        return [{"ok": False, "url": url, "error": "Invalid URL format"}]
    
    # Check if playlist
    is_playlist = "playlist" in url.lower() or "list=" in url.lower()
    if is_playlist:
        try:
            pl = get_playlist_info(URLRequest(url=url))
            results = []
            for v in pl.get("videos", []):
                results.append({
                    "ok": True,
                    "url": v.get("url"),
                    "title": v.get("title") or "Video",
                    "thumbnail": v.get("thumbnail") or "",
                    "duration": v.get("duration"),
                    "uploader": v.get("uploader") or pl.get("uploader") or "",
                    "platform": "YouTube Playlist",
                    "qualities": [
                        {"height": 1080, "label": "1080p", "size": None},
                        {"height": 720, "label": "720p", "size": None},
                        {"height": 480, "label": "480p", "size": None},
                        {"height": 360, "label": "360p", "size": None},
                    ]
                })
            if results:
                return results
        except Exception:
            pass # fallback to single video info

    try:
        info = get_video_info(URLRequest(url=url))
        return [{
            "ok": True,
            "url": url,
            "title": info.get("title") or "Video",
            "thumbnail": info.get("thumbnail") or "",
            "duration": info.get("duration"),
            "uploader": info.get("uploader") or "",
            "platform": info.get("platform") or "Video",
            "qualities": info.get("qualities") or []
        }]
    except Exception as e:
        return [{
            "ok": False,
            "url": url,
            "error": clean_error(e)
        }]


@app.post("/api/bulk-info")
def get_bulk_info(request: BulkInfoRequest):
    urls = [u.strip() for u in request.urls if u.strip() and is_valid_url(u.strip())]
    if not urls:
        raise HTTPException(status_code=400, detail="Koi valid URLs provide nahi kiye gaye.")
    
    # Cap to 50 URLs at a time
    urls = urls[:50]
    
    items = []
    with ThreadPoolExecutor(max_workers=min(len(urls), 6)) as executor:
        futures = [executor.submit(_analyze_single_url, u) for u in urls]
        for f in futures:
            try:
                res_list = f.result(timeout=35)
                items.extend(res_list)
            except Exception as err:
                items.append({"ok": False, "url": "unknown", "error": str(err)})

    return {
        "ok": True,
        "total": len(items),
        "items": items
    }


# ------------------------------------------------------------
# Downloads Library & Stream
# ------------------------------------------------------------

@app.get("/api/history")
def get_history():
    files = []
    seen = set()
    total_size = 0
    dirs = [DOWNLOAD_DIR]
    old_dir = DATA_DIR / "downloads"
    if old_dir.exists() and old_dir.resolve() != DOWNLOAD_DIR.resolve():
        dirs.append(old_dir)

    # Only allowed media extensions
    MEDIA_EXTS = {
        ".mp4", ".mkv", ".webm", ".avi", ".mov", ".flv", ".wmv", ".m4v",
        ".mp3", ".m4a", ".wav", ".aac", ".flac", ".opus", ".ogg"
    }
    SKIP_SUFFIXES = (".part", ".ytdl", ".temp", ".json", ".jpg", ".jpeg",
                    ".png", ".webp", ".gif", ".txt", ".srt", ".vtt")

    for d in dirs:
        if not d.exists():
            continue
        for f in d.glob("*"):
            ext = f.suffix.lower()
            if (
                f.is_file()
                and ext in MEDIA_EXTS
                and not f.name.endswith(SKIP_SUFFIXES)
                and f.name not in seen
            ):
                seen.add(f.name)
                try:
                    stat = f.stat()
                    total_size += stat.st_size
                    is_audio = ext in {".mp3", ".m4a", ".wav", ".aac", ".flac", ".opus", ".ogg"}
                    quoted = quote(f.name)
                    files.append({
                        "name": f.name,
                        "size": format_bytes(stat.st_size) or "0 B",
                        "raw_size": stat.st_size,
                        "mtime": stat.st_mtime,
                        "is_audio": is_audio,
                        "ext": ext,
                        "download_url": f"/api/download-file/{quoted}",
                        "stream_url": f"/api/stream/{quoted}"
                    })
                except Exception:
                    pass
    files.sort(key=lambda x: x["mtime"], reverse=True)
    return {
        "ok": True,
        "download_dir": str(DOWNLOAD_DIR),
        "total_files": len(files),
        "total_size": format_bytes(total_size) or "0 B",
        "raw_total_size": total_size,
        "files": files
    }


@app.get("/api/download-file/{filename}")
def download_by_filename(filename: str):
    clean_name = Path(filename).name
    file_path = DOWNLOAD_DIR / clean_name
    if not file_path.exists() or not file_path.is_file():
        file_path = DATA_DIR / "downloads" / clean_name
        if not file_path.exists() or not file_path.is_file():
            raise HTTPException(status_code=404, detail="File nahi mili.")
            
    safe_ascii = re.sub(r'[^\w\.-]', '_', clean_name)
    quoted = quote(clean_name)
    media_type = "video/mp4" if clean_name.lower().endswith(".mp4") else ("audio/mpeg" if clean_name.lower().endswith(".mp3") else "application/octet-stream")
    return FileResponse(
        path=str(file_path),
        filename=clean_name,
        headers={"Content-Disposition": f'attachment; filename="{safe_ascii}"; filename*=UTF-8\'\'{quoted}'},
        media_type=media_type
    )


@app.post("/api/open-file/{filename}")
def open_file_in_explorer(filename: str):
    clean_name = Path(filename).name
    file_path = DOWNLOAD_DIR / clean_name
    if not file_path.exists():
        file_path = DATA_DIR / "downloads" / clean_name

    import subprocess
    if file_path.exists() and file_path.is_file():
        try:
            subprocess.Popen(["explorer.exe", f"/select,{str(file_path.resolve())}"])
            return {"ok": True}
        except Exception:
            pass

    try:
        subprocess.Popen(["explorer.exe", str(DOWNLOAD_DIR.resolve())])
        return {"ok": True}
    except Exception:
        try:
            os.startfile(str(DOWNLOAD_DIR))
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e)}


@app.get("/api/stream/{filename}")
def stream_file(filename: str):
    clean_name = Path(filename).name
    file_path = DOWNLOAD_DIR / clean_name
    if not file_path.exists() or not file_path.is_file():
        file_path = DATA_DIR / "downloads" / clean_name
        if not file_path.exists() or not file_path.is_file():
            raise HTTPException(status_code=404, detail="File nahi mili.")
    
    ext = file_path.suffix.lower()
    media_type = "video/mp4"
    if ext in [".mp3", ".m4a", ".aac", ".wav"]:
        media_type = f"audio/{ext.replace('.', '')}"
        if ext == ".mp3":
            media_type = "audio/mpeg"
    elif ext in [".webm", ".mkv"]:
        media_type = f"video/{ext.replace('.', '')}"
        
    return FileResponse(
        path=str(file_path),
        media_type=media_type,
        filename=clean_name
    )


@app.delete("/api/file/{filename}")
def delete_file(filename: str):
    clean_name = Path(filename).name
    deleted = False
    for d in [DOWNLOAD_DIR, DATA_DIR / "downloads"]:
        file_path = d / clean_name
        if file_path.exists() and file_path.is_file():
            try:
                file_path.unlink()
                deleted = True
            except Exception as e:
                raise HTTPException(status_code=500, detail=str(e))
    if deleted:
        db_delete_by_filename(clean_name)
        return {"ok": True, "message": f"{clean_name} delete ho gayi."}
    raise HTTPException(status_code=404, detail="File nahi mili.")