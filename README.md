# 🚀 ZDownloader PRO by Basit
**Universal High-Speed Video & Audio Downloader**  
*(FastAPI Backend + Cyberpunk Web UI + Desktop App + Chrome Extension MV3)*

Supports **YouTube, Facebook, Pinterest, Instagram, TikTok, Twitter/X, Vimeo**, and 1000+ other websites in high resolutions (4K, 1080p, 720p, MP3 Audio, etc.).

---

## ⚡ 1-Click Master Setup (Recommended)

Ab setup karna aur use karna 100% asaan aur automatic hai!

Simply double-click **`OneClick_Setup.bat`**:
- ✅ Python check karega (agar na ho to auto-install karega)
- ✅ Saari dependencies (`yt-dlp` wagera) automatically install karega
- ✅ Windows Startup mein Silent Background Auto-Start configure karega
- ✅ Browser 1-Click Protocol (`zdownloader://`) register karega
- ✅ Desktop par **ZDownloader PRO** shortcut create karega
- ✅ Background engine (Port 8000) foran start kar dega bina kisi terminal window ke!

---

## 📂 Project Structure

- `frontend/` — Cyberpunk dark-mode web application (Instant Download, Bulk Batch Downloader, Video Library & Media Player).
- `extension/` — Chrome Extension Manifest V3 (Vibrant popup UI, Draggable FAB button, Sniffer, Subtitle/Thumbnail grabbers).
- `OneClick_Setup.bat` — 1-Click all-in-one installer and autostart configurator.
- `setup_autostart.bat` & `remove_autostart.bat` — Windows startup & browser protocol management.
- `run_silent_backend.vbs` — Hidden background launcher (0 terminal popups).
- `main.py` — High-performance FastAPI backend powered by `yt-dlp`.
- `desktop_app.py` — Standalone desktop window app powered by `pywebview`.
- `ZDownloader_v3.zip` — Ready-to-install Chrome Extension package.
- `HOW_TO_USE.txt` — Simple Urdu/English guide for end users.

---

## 🧩 Chrome Extension Install Karein

1. Google Chrome open karein aur address bar mein likhein:  
   `chrome://extensions/`
2. Top-right corner par **Developer mode** ka toggle ON karein.
3. Top-left par **Load unpacked** button par click karein.
4. Is project ke andar **`extension`** folder select karein.
5. Extensions toolbar se **ZDownloader** ko Pin karein!

> **Note:** Agar backend kabhi band bhi ho jaye, to Extension Popup mein **"🚀 1-Click Auto-Start Backend"** button par click karne se engine browser se hi auto-start ho jata hai!

---

## 🌟 Powerhouse Features

1. **Smart Video Detection & FAB:** YouTube, Pinterest, Facebook par automatic floating download button.
2. **Multi-Video Sniffer:** Web page par jitni bhi videos mojood hon, ek click mein sab ko detect karta hai.
3. **HD Thumbnail Downloader:** Single click mein kisi bhi video ka Ultra-HD cover photo download karein.
4. **Subtitles (.SRT) Downloader:** Video subtitles ko directly `.srt` format mein download karein.
5. **Direct Download Link Copier:** Direct media CDN stream link copy karein taake IDM ya browser mein paste kar sakein.
6. **Audio Chime Feedback:** Video download mukammal hone par pleasing audio alert chime bajti hai.
7. **Turbo Multi-Thread Mode:** Extreme speed ke liye multi-connection chunk downloading.
8. **Bulk Batch Downloader:** Ek sath 20+ links paste karein aur one-click batch download karein.
9. **Built-in Media Player:** Downloaded videos ko app ke andar hi play karein.
10. **Silent Windows Auto-Start:** Har boot par backend chup-chap background mein on rehta hai.

---

## 🛠️ Tech Stack
- **Backend:** Python 3.10+, FastAPI, Uvicorn, yt-dlp, pinterest-downloader
- **Frontend:** Vanilla HTML5, Cyberpunk CSS Tokens, JavaScript ES6
- **Extension:** Chrome Manifest V3 (Service Worker + Content Script + Popup)
- **Desktop:** PyWebView native window
- **System Integration:** Windows VBScript WScript.Shell, Registry URL Protocols

---

## 👤 Author
Developed with ❤️ by **Basit**  
