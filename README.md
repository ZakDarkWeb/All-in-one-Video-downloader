# 🚀 ZDownloader by Zak
**Universal High-Speed Video & Audio Downloader**  
*(FastAPI Backend + Cyberpunk Web UI + Desktop App + Chrome Extension)*

Supports **YouTube, Facebook, Pinterest, Instagram, TikTok, Twitter/X, Vimeo**, and 1000+ other websites in high resolutions (4K, 1080p, 720p, MP3 Audio, etc.).

---

## 📂 Project Structure

- `frontend/` — Cyberpunk dark-mode web application (Instant Download, Bulk Batch Downloader, Video Library & Media Player).
- `extension/` — Chrome Extension (Vibrant popup UI, Draggable page video detector FAB button, Download Queue).
- `main.py` — High-performance FastAPI backend powered by `yt-dlp`.
- `desktop_app.py` — Standalone desktop window app powered by `pywebview`.
- `ZDownloader_v3.zip` — Ready-to-install Chrome Extension package.

---

## ⚡ Quick Start Guide (Kaise Run Karein)

### 1️⃣ Step 1: Dependencies Install Karein (First time only)
Agar aap pehli dafa run kar rahe hain:
- Simply double-click **`install_dependencies.bat`**  
  *(Yeh automatically `pip install -r requirements.txt` run kar dega)*

---

### 2️⃣ Step 2: App Run Karein
Aapke paas 3 asaan options hain:

* **Option A (Web UI + Browser Auto-Open):**  
  Double-click **`start.bat`**  
  *(Backend start hoga aur browser mein `http://localhost:8000` khud open ho jayega)*

* **Option B (Desktop App Window):**  
  Double-click **`start_app.bat`**  
  *(Baghair browser ke ek separate clean Desktop Window app khulegi)*

* **Option C (Sirf Backend for Extension):**  
  Double-click **`start_backend.bat`**  
  *(Port 8000 par backend chalega)*

---

### 3️⃣ Step 3: Chrome Extension Install Karein

1. Google Chrome open karein aur address bar mein type karein:  
   `chrome://extensions/`
2. Top-right corner par **Developer mode** ka toggle ON karein.
3. Top-left par **Load unpacked** button par click karein.
4. Is project ke andar **`extension`** folder select karein (ya **`ZDownloader_v3.zip`** ko unzip karke wo folder select karein).
5. ZDownloader Extension ready hai! Browser ke toolbar se pin kar lein.

---

## 🌟 Key Features

1. **Smart Video Detection:** YouTube, Pinterest, Facebook par automatic floating download button.
2. **Quality Selector:** 1080p, 720p, 480p, 360p ya Audio-only (MP3).
3. **Bulk Downloader:** Ek sath 20+ links paste karein aur one-click batch download karein.
4. **Built-in Media Player:** Downloaded videos ko app ke andar hi play karein.
5. **Auto-Updater:** Settings tab se yt-dlp ko 1-click mein latest version par update karein.
6. **Custom Save Folder:** Downloads ko apni marzi ke folder mein save karein.

---

## 🛠️ Tech Stack
- **Backend:** Python 3.10+, FastAPI, Uvicorn, yt-dlp, pinterest-downloader
- **Frontend:** Vanilla HTML5, Modern CSS Glassmorphism, JavaScript ES6
- **Extension:** Chrome Manifest V3
- **Desktop:** PyWebView
