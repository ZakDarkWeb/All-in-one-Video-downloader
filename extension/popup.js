const API_BASE = "http://127.0.0.1:8000";

const $ = id => document.getElementById(id);
let activeUrl = "";
let currentVideoData = null;
let statusPollInterval = null;
let currentDoneJobId = null;
let lastChimedJobId = null;

let settings = { quality: "best", autoDownload: false, inPage: true, sound: true, turbo: false };

const PLATFORMS = [
  { name: "YouTube",    rx: /youtu(\.be|be\.com)/i,      icon: "🔴", color: "#ef4444" },
  { name: "Instagram",  rx: /instagram\.com/i,           icon: "🟣", color: "#d946ef" },
  { name: "Pinterest",  rx: /pinterest\.com|pin\.it/i,   icon: "📌", color: "#e60023" },
  { name: "TikTok",    rx: /tiktok\.com/i,               icon: "🎵", color: "#06b6d4" },
  { name: "Snapchat",  rx: /snapchat\.com/i,             icon: "👻", color: "#eab308" },
  { name: "Facebook",  rx: /facebook\.com|fb\.watch/i,   icon: "🔵", color: "#3b82f6" },
  { name: "X / Twitter", rx: /twitter\.com|x\.com/i,    icon: "⚫", color: "#cbd5e1" }
];

document.addEventListener("DOMContentLoaded", async () => {
  await loadSettings();
  setupTabs();
  setupUI();
  setupMessageListener();
  const isOnline = await checkServerStatus();
  if (isOnline) onServerConnected();
});

// ── Settings ──────────────────────────────────────────────────────
async function loadSettings() {
  try {
    const data = await chrome.storage.local.get("zdl_settings");
    if (data.zdl_settings) settings = { ...settings, ...data.zdl_settings };
  } catch {}
  applySettingsToUI();
}

function applySettingsToUI() {
  if ($("settingQuality")) $("settingQuality").value = settings.quality;
  if ($("settingAutoDownload")) $("settingAutoDownload").checked = !!settings.autoDownload;
  if ($("settingInPage")) $("settingInPage").checked = settings.inPage !== false;
  if ($("settingSound")) $("settingSound").checked = settings.sound !== false;
  if ($("settingTurbo")) $("settingTurbo").checked = !!settings.turbo;
}

async function saveSettings() {
  settings.quality = $("settingQuality")?.value || "best";
  settings.autoDownload = $("settingAutoDownload")?.checked || false;
  settings.inPage = $("settingInPage")?.checked !== false;
  settings.sound = $("settingSound")?.checked !== false;
  settings.turbo = !!$("settingTurbo")?.checked;
  try { await chrome.storage.local.set({ zdl_settings: settings }); } catch {}
  const flash = $("saveFlash");
  if (flash) {
    flash.style.display = "block";
    flash.style.animation = "none";
    void flash.offsetWidth;
    flash.style.animation = "fadeOut 2.5s forwards";
    setTimeout(() => { flash.style.display = "none"; }, 2600);
  }
}

// ── Tabs ──────────────────────────────────────────────────────────
// HTML uses: class="tab", data-tab="panelDl/panelHist/panelSett"
// Panels:    class="panel", id="panelDl/panelHist/panelSett"
function setupTabs() {
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
      const panelId = btn.dataset.tab;
      document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      const panel = $(panelId);
      if (panel) panel.classList.add("active");
      if (panelId === "panelHist") loadHistory();
      if (panelId === "panelSett") loadDiagnostics();
    });
  });
}

function switchToDownloadTab() {
  document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
  const tabDl = $("tabDl");
  const panelDl = $("panelDl");
  if (tabDl) tabDl.classList.add("active");
  if (panelDl) panelDl.classList.add("active");
}

// ── UI Setup ──────────────────────────────────────────────────────
function setupUI() {
  // Paste link button
  const manualBtn = $("toggleManualBtn");
  if (manualBtn) {
    manualBtn.onclick = () => {
      switchToDownloadTab();
      const panel = $("manualPanel");
      if (panel) {
        const open = panel.classList.toggle("show");
        if (open && $("manualUrl")) $("manualUrl").focus();
      }
    };
  }

  // Fetch manual URL
  if ($("manualFetchBtn")) {
    $("manualFetchBtn").onclick = () => {
      const url = $("manualUrl")?.value.trim();
      if (url) loadVideoInfo(url);
    };
  }

  if ($("manualUrl")) {
    $("manualUrl").addEventListener("keydown", e => {
      if (e.key === "Enter") {
        const url = $("manualUrl").value.trim();
        if (url) loadVideoInfo(url);
      }
    });
  }

  // Paste clipboard
  if ($("pasteClipBtn")) {
    $("pasteClipBtn").onclick = async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text && text.startsWith("http")) {
          $("manualUrl").value = text.trim();
          loadVideoInfo(text.trim());
        }
      } catch { if ($("manualUrl")) $("manualUrl").focus(); }
    };
  }

  // Retry
  if ($("retryBtn")) {
    $("retryBtn").onclick = async () => {
      $("retryBtn").textContent = "⏳ Retrying...";
      const ok = await checkServerStatus();
      if (ok) onServerConnected();
      else setTimeout(() => { $("retryBtn").textContent = "🔄 Retry"; }, 1000);
    };
  }

  // 1-Click Auto-Start Engine (custom protocol handler zdownloader://start)
  if ($("autoStartEngineBtn")) {
    $("autoStartEngineBtn").onclick = () => {
      const btn = $("autoStartEngineBtn");
      btn.textContent = "⚡ Starting Engine...";
      btn.style.opacity = "0.75";
      try {
        window.location.href = "zdownloader://start";
      } catch (e) {
        console.warn("Protocol launch failed:", e);
      }
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        const ok = await checkServerStatus();
        if (ok) {
          clearInterval(poll);
          btn.textContent = "✅ Connected!";
          btn.style.opacity = "1";
          onServerConnected();
        } else if (attempts >= 8) {
          clearInterval(poll);
          btn.textContent = "🚀 1-Click Auto-Start Backend";
          btn.style.opacity = "1";
        }
      }, 1000);
    };
  }

  // Folder buttons
  if ($("openFolderBtn")) $("openFolderBtn").onclick = openDownloadsFolder;
  if ($("openFolderFooterBtn")) $("openFolderFooterBtn").onclick = openDownloadsFolder;

  // Web App buttons
  if ($("openWebAppBtn")) $("openWebAppBtn").onclick = () => chrome.tabs.create({ url: "http://127.0.0.1:8000" });
  if ($("openWebAppBtn2")) $("openWebAppBtn2").onclick = () => chrome.tabs.create({ url: "http://127.0.0.1:8000" });

  // Save HD Thumbnail
  if ($("saveThumbBtn")) {
    $("saveThumbBtn").onclick = () => {
      const thumbUrl = currentVideoData?.thumbnail;
      if (!thumbUrl) return;
      const title = (currentVideoData?.title || "thumbnail").replace(/[^\w\s-]/g, "").trim().slice(0, 40);
      chrome.runtime.sendMessage({
        action: "DOWNLOAD_URL",
        url: thumbUrl,
        filename: `ZDownloader/${title}_thumb.jpg`
      }, res => {
        const btn = $("saveThumbBtn");
        if (btn) {
          const orig = btn.textContent;
          btn.textContent = res?.ok ? "✅ Saved!" : "❌ Error";
          setTimeout(() => { btn.textContent = orig; }, 2000);
        }
      });
    };
  }

  // Copy Direct Link
  if ($("copyLinkBtn")) {
    $("copyLinkBtn").onclick = () => {
      const urlToCopy = activeUrl || window.location.href;
      if (!urlToCopy) return;
      navigator.clipboard.writeText(urlToCopy).then(() => {
        const btn = $("copyLinkBtn");
        if (btn) {
          const orig = btn.textContent;
          btn.textContent = "✅ Copied!";
          setTimeout(() => { btn.textContent = orig; }, 2000);
        }
      });
    };
  }

  // Download Subtitles
  if ($("dlSubBtn")) {
    $("dlSubBtn").onclick = async () => {
      const btn = $("dlSubBtn");
      const msg = $("subMsg");
      const lang = $("subLangSelect")?.value || "en";
      btn.textContent = "⏳ Fetching…";
      btn.disabled = true;
      if (msg) { msg.style.display = "block"; msg.textContent = "Downloading subtitles…"; msg.style.color = "#94a3b8"; }

      try {
        const res = await fetch(`${API_BASE}/api/subtitles`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: activeUrl, lang })
        });
        const d = await res.json();
        if (d.ok) {
          btn.textContent = "✅ .SRT Saved!";
          if (msg) { msg.textContent = d.message || "Saved to Downloads"; msg.style.color = "#34d399"; }
          playSuccessChime();
        } else {
          btn.textContent = "❌ Failed";
          if (msg) { msg.textContent = d.detail || "Failed to download subtitles"; msg.style.color = "#f87171"; }
        }
      } catch (err) {
        btn.textContent = "❌ Error";
        if (msg) { msg.textContent = err.message || "Network error"; msg.style.color = "#f87171"; }
      }
      setTimeout(() => {
        btn.textContent = "📝 Download .SRT";
        btn.disabled = false;
      }, 3000);
    };
  }

  // Thumbnail error
  if ($("thumbImg")) $("thumbImg").onerror = () => showFallbackThumbnail();

  // Clip trimmer
  if ($("clipCheck")) {
    $("clipCheck").addEventListener("change", () => {
      const panel = $("clipPanel");
      if (panel) panel.classList.toggle("show", $("clipCheck").checked);
    });
  }

  // QR buttons
  if ($("showQrBtn")) $("showQrBtn").onclick = showQrCode;
  if ($("qrCloseBtn")) $("qrCloseBtn").onclick = () => { if ($("qrCard")) $("qrCard").classList.remove("show"); };

  // History tab
  if ($("histSearch")) $("histSearch").addEventListener("input", filterHistory);
  if ($("refreshHistBtn")) $("refreshHistBtn").onclick = () => loadHistory(true);

  // Settings save
  if ($('saveSettingsBtn')) $('saveSettingsBtn').onclick = saveSettings;

  // Update yt-dlp
  if ($('updateYtdlpBtn')) {
    $('updateYtdlpBtn').onclick = async () => {
      const btn = $('updateYtdlpBtn');
      const status = $('updateStatus');
      btn.textContent = '⏳ Updating...';
      btn.style.opacity = '0.6';
      btn.disabled = true;
      if (status) { status.style.display = 'block'; status.textContent = 'Downloading latest yt-dlp...'; }
      try {
        const res = await fetch(`${API_BASE}/api/update-ytdlp`, { method: 'POST' });
        const data = await res.json();
        if (status) {
          status.textContent = data.message || (data.ok ? '✅ Updated!' : '❌ Failed');
          status.style.color = data.ok ? '#34d399' : '#f87171';
        }
        btn.textContent = data.ok ? '✅ yt-dlp Updated!' : '❌ Update Failed';
      } catch {
        btn.textContent = '❌ Backend Offline';
        if (status) { status.textContent = 'Start the backend first.'; status.style.color = '#f87171'; }
      }
      btn.disabled = false;
      btn.style.opacity = '1';
    };
  }

  // Set custom download folder
  if ($('setFolderBtn')) {
    $('setFolderBtn').onclick = async () => {
      const path = $('customFolderInput')?.value.trim();
      if (!path) return;
      try {
        const res = await fetch(`${API_BASE}/api/set-download-dir`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path })
        });
        const data = await res.json();
        if (data.ok) {
          if ($('currentFolderLabel')) $('currentFolderLabel').textContent = data.download_dir;
          if ($('diagFolder')) $('diagFolder').textContent = data.download_dir;
          $('setFolderBtn').textContent = '✅ Set!';
          setTimeout(() => { $('setFolderBtn').textContent = 'Set Folder'; }, 2000);
        }
      } catch {}
    };
  }
}

// ── Server Status ─────────────────────────────────────────────────
function onServerConnected() {
  chrome.runtime.sendMessage({ action: "GET_ACTIVE_DOWNLOAD" }, response => {
    if (response && response.activeDownload &&
        ["downloading","starting","processing"].includes(response.activeDownload.status)) {
      renderActiveDownload(response.activeDownload);
    } else {
      detectAndLoadTabVideo();
    }
  });
}

async function checkServerStatus() {
  try {
    const r = await new Promise(resolve => {
      chrome.runtime.sendMessage({ action: "CHECK_STATUS" }, res => {
        if (chrome.runtime.lastError || !res) resolve(null);
        else resolve(res);
      });
    });
    if (r && r.ok) { markOnline(); return true; }
  } catch {}

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`${API_BASE}/api/status`, { signal: ctrl.signal });
    clearTimeout(t);
    if (res.ok) { markOnline(); return true; }
  } catch {}

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch("http://localhost:8000/api/status", { signal: ctrl.signal });
    clearTimeout(t);
    if (res.ok) { markOnline(); return true; }
  } catch {}

  markOffline();
  return false;
}

function markOnline() {
  const chip = $("statusChip");
  if (chip) chip.className = "status-pill online";
  if ($("statusText")) $("statusText").textContent = "Online";
  const ob = $("offlineBox");
  if (ob) ob.classList.remove("show");
  if (statusPollInterval) { clearInterval(statusPollInterval); statusPollInterval = null; }
}

function markOffline() {
  const chip = $("statusChip");
  if (chip) chip.className = "status-pill offline";
  if ($("statusText")) $("statusText").textContent = "Offline";
  const ob = $("offlineBox");
  if (ob) ob.classList.add("show");
  if ($("loaderBox")) $("loaderBox").style.display = "none";
  if ($("emptyState")) $("emptyState").style.display = "flex";

  if (!statusPollInterval) {
    statusPollInterval = setInterval(async () => {
      const ok = await checkServerStatus();
      if (ok) onServerConnected();
    }, 3000);
  }
}

// ── Video Detection ───────────────────────────────────────────────
async function detectAndLoadTabVideo() {
  scanAndRenderPageMedia();
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && !tab.url.startsWith("chrome://") && !tab.url.startsWith("edge://")) {
      activeUrl = tab.url;
      loadVideoInfo(tab.url);
    } else {
      showManualFallback("No video page detected — paste a link below");
    }
  } catch {
    showManualFallback("Paste a video link to download");
  }
}

async function loadVideoInfo(url) {
  if ($("loaderBox")) $("loaderBox").style.display = "flex";
  if ($("loaderMsg")) $("loaderMsg").textContent = "Analyzing video…";
  if ($("videoCard")) $("videoCard").classList.remove("show");
  const fw = $("formatsWrap");
  if (fw) fw.classList.remove("show");
  if ($("doneCard")) $("doneCard").classList.remove("show");
  if ($("progressCard")) $("progressCard").classList.remove("show");
  if ($("emptyState")) $("emptyState").style.display = "none";
  if ($("qrCard")) $("qrCard").classList.remove("show");

  try {
    const bgRes = await new Promise(resolve => {
      chrome.runtime.sendMessage({ action: "GET_INFO", url }, res => {
        if (chrome.runtime.lastError || !res) resolve(null);
        else resolve(res);
      });
    });
    if (bgRes && bgRes.ok && bgRes.data) {
      activeUrl = url;
      currentVideoData = bgRes.data;
      if ($("loaderBox")) $("loaderBox").style.display = "none";
      renderVideoCard(bgRes.data, url);
      return;
    }
  } catch {}

  try {
    const res = await fetch(`${API_BASE}/api/info`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Failed");
    activeUrl = url;
    currentVideoData = data;
    if ($("loaderBox")) $("loaderBox").style.display = "none";
    renderVideoCard(data, url);
  } catch {
    if ($("loaderBox")) $("loaderBox").style.display = "none";
    showManualFallback("Video not detected — paste URL manually");
  }
}

function showManualFallback(placeholder) {
  if ($("loaderBox")) $("loaderBox").style.display = "none";
  if ($("emptyState")) $("emptyState").style.display = "flex";
  const panel = $("manualPanel");
  if (panel) panel.classList.add("show");
  if ($("manualUrl")) {
    $("manualUrl").placeholder = placeholder;
    // Check clipboard for copied video URL
    if (navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard.readText().then(text => {
        if (text && text.startsWith("http") && !$("manualUrl").value) {
          for (const p of PLATFORMS) {
            if (p.rx.test(text)) {
              $("manualUrl").value = text.trim();
              break;
            }
          }
        }
      }).catch(() => {});
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────
function fmtDuration(sec) {
  if (!sec) return "";
  sec = Math.round(sec);
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function detectPlatform(url, rawPlatform) {
  for (const p of PLATFORMS) if (p.rx.test(url || "")) return p;
  return { name: rawPlatform || "Media", icon: "🎬", color: "#38bdf8" };
}

function showFallbackThumbnail(plat) {
  plat = plat || detectPlatform(activeUrl, currentVideoData?.platform);
  if ($("thumbImg")) $("thumbImg").style.display = "none";
  const fb = $("thumbFallback");
  if (fb) fb.classList.add("show");
  if ($("fallbackIcon")) $("fallbackIcon").textContent = plat.icon || "🎬";
  if ($("fallbackName")) $("fallbackName").textContent = (plat.name || "MEDIA").toUpperCase();
}

function setThumbnail(thumbUrl, plat) {
  if (!thumbUrl) { showFallbackThumbnail(plat); return; }
  const fb = $("thumbFallback");
  if (fb) fb.classList.remove("show");
  if ($("thumbImg")) {
    $("thumbImg").style.display = "block";
    $("thumbImg").src = thumbUrl;
  }
}

// ── Render Video Card ─────────────────────────────────────────────
function renderVideoCard(data, url) {
  if ($("loaderBox")) $("loaderBox").style.display = "none";

  const plat = detectPlatform(url, data.platform);
  setThumbnail(data.thumbnail, plat);

  if ($("vidTitle")) $("vidTitle").textContent = data.title || "Video";

  const platChip = $("platChip");
  if (platChip) {
    platChip.textContent = `${plat.icon} ${plat.name}`;
  }

  const dur = fmtDuration(data.duration);
  const durEl = $("durBadge");
  if (durEl) {
    if (dur) { durEl.style.display = "block"; durEl.textContent = dur; }
    else { durEl.style.display = "none"; }
  }

  if ($("videoCard")) $("videoCard").classList.add("show");

  // Build format buttons
  const list = $("qualityList");
  if (!list) return;
  list.innerHTML = "";

  if (settings.autoDownload) {
    triggerDownload(settings.quality, false);
    return;
  }

  // Best Quality — full width
  list.appendChild(makeQBtn({
    cls: "best fmt-full",
    icon: "⭐",
    label: "Best Quality",
    sub: "Auto-HD • Maximum speed",
    onclick: () => triggerDownload("best", false)
  }));

  // Specific resolutions
  if (data.qualities && data.qualities.length) {
    data.qualities.slice(0, 2).forEach(q => {
      list.appendChild(makeQBtn({
        cls: "",
        icon: "🎬",
        label: q.label || (q.height + "p"),
        sub: q.size || "MP4 Video",
        onclick: () => triggerDownload(String(q.height), false)
      }));
    });
  } else {
    list.appendChild(makeQBtn({
      cls: "",
      icon: "🎬",
      label: "1080p Full HD",
      sub: "MP4 Video",
      onclick: () => triggerDownload("1080", false)
    }));
    list.appendChild(makeQBtn({
      cls: "",
      icon: "🎬",
      label: "720p HD",
      sub: "MP4 Video",
      onclick: () => triggerDownload("720", false)
    }));
  }

  // Audio
  list.appendChild(makeQBtn({
    cls: "audio",
    icon: "🎧",
    label: "MP3 Audio",
    sub: "320kbps • Audio only",
    onclick: () => triggerDownload("best", true)
  }));

  // Show the format section
  const fw = $("formatsWrap");
  if (fw) fw.classList.add("show");
  if ($("emptyState")) $("emptyState").style.display = "none";

  // Subtitles section
  const subsWrap = $("subsWrap");
  const subSelect = $("subLangSelect");
  if (data.subtitles && data.subtitles.length > 0 && subsWrap && subSelect) {
    subsWrap.style.display = "flex";
    subSelect.innerHTML = "";
    data.subtitles.forEach(lang => {
      const opt = document.createElement("option");
      opt.value = lang;
      opt.textContent = lang.toUpperCase();
      subSelect.appendChild(opt);
    });
  } else if (subsWrap) {
    subsWrap.style.display = "none";
  }
}

function makeQBtn({ cls, icon, label, sub, onclick }) {
  const btn = document.createElement("button");
  btn.className = "fmt-btn" + (cls ? " " + cls : "");
  btn.innerHTML = `
    <div class="fmt-icon">${icon}</div>
    <div class="fmt-info">
      <div class="fmt-name">${label}</div>
      <div class="fmt-sub">${sub}</div>
    </div>
    <span class="fmt-arrow">›</span>
  `;
  btn.onclick = onclick;
  return btn;
}

// ── Trigger Download ──────────────────────────────────────────────
function triggerDownload(quality, audioOnly) {
  document.querySelectorAll(".fmt-btn").forEach(b => b.disabled = true);

  if ($("progressCard")) $("progressCard").classList.add("show");
  if ($("doneCard")) $("doneCard").classList.remove("show");
  if ($("qrCard")) $("qrCard").classList.remove("show");
  if ($("progBarFill")) $("progBarFill").style.width = "0%";
  if ($("progressPct")) $("progressPct").textContent = "0%";
  if ($("progressStatus")) $("progressStatus").textContent = "⚡ Starting…";
  if ($("progSpeed")) $("progSpeed").textContent = "-- MB/s";
  if ($("progEta")) $("progEta").textContent = "ETA --";

  const title = currentVideoData?.title || "Video";
  const thumbnail = currentVideoData?.thumbnail || "";

  let startTime = null, endTime = null;
  if ($("clipCheck") && $("clipCheck").checked) {
    const s = $("clipStart")?.value.trim();
    const e = $("clipEnd")?.value.trim();
    if (s) startTime = s;
    if (e) endTime = e;
  }

  chrome.runtime.sendMessage({
    action: "START_DOWNLOAD",
    url: activeUrl,
    quality,
    audioOnly,
    title,
    thumbnail,
    startTime,
    endTime,
    turbo: !!settings.turbo
  }, response => {
    if (!response) {
      alert("Extension error — try refreshing the page.");
      document.querySelectorAll(".fmt-btn").forEach(b => b.disabled = false);
      if ($("progressCard")) $("progressCard").classList.remove("show");
      return;
    }
    if (response.queued) {
      // Show queued state instead of progress
      if ($("progressCard")) $("progressCard").classList.remove("show");
      if ($("progressStatus")) $("progressStatus").textContent = `📝 Queued #${response.position}`;
      if ($("progressPct")) $("progressPct").textContent = "Q";
      // Re-enable buttons so user can queue more
      document.querySelectorAll(".fmt-btn").forEach(b => b.disabled = false);
      // Show a small toast
      const fw = $("formatsWrap");
      const toast = document.createElement("div");
      toast.style.cssText = "font-size:11px;color:#fbbf24;text-align:center;padding:6px;animation:fadeOut 3s forwards;";
      toast.textContent = `⏳ Added to queue (#${response.position})`;
      if (fw) fw.appendChild(toast);
      setTimeout(() => toast.remove(), 3200);
      return;
    }
    if (!response.ok) {
      alert(response.error || "Failed to start download");
      document.querySelectorAll(".fmt-btn").forEach(b => b.disabled = false);
      if ($("progressCard")) $("progressCard").classList.remove("show");
    }
  });
}

// ── Active Download Render ────────────────────────────────────────
function renderActiveDownload(dl) {
  if ($("loaderBox")) $("loaderBox").style.display = "none";
  const fw = $("formatsWrap");
  if (fw) fw.classList.remove("show");
  if ($("progressCard")) $("progressCard").classList.add("show");

  // Disable buttons on any active state
  if (["starting","downloading","processing"].includes(dl.status)) {
    document.querySelectorAll(".fmt-btn").forEach(b => b.disabled = true);
  }

  const plat = detectPlatform(dl.url || activeUrl);

  if (dl.title && $("vidTitle")) {
    $("vidTitle").textContent = dl.title;
    if ($("platChip")) $("platChip").textContent = `${plat.icon} ${plat.name}`;
    if ($("videoCard")) $("videoCard").classList.add("show");
  }

  if (dl.thumbnail) setThumbnail(dl.thumbnail, plat);
  else showFallbackThumbnail(plat);

  const pct = Math.round(dl.progress || 0);
  if ($("progBarFill")) $("progBarFill").style.width = `${pct}%`;
  if ($("progressPct")) $("progressPct").textContent = `${pct}%`;

  const labels = {
    starting: "⚡ Starting…",
    downloading: "🚀 Downloading…",
    processing: "⚙️ Merging…",
    done: "✅ Complete!",
    error: "❌ Failed"
  };
  if ($("progressStatus")) $("progressStatus").textContent = labels[dl.status] || dl.status;
  if ($("progSpeed")) $("progSpeed").textContent = dl.speed || "High Speed";
  if ($("progEta")) $("progEta").textContent = dl.eta ? `ETA ${dl.eta}` : "Calculating";

  if (dl.status === "done") {
    if ($("progressCard")) $("progressCard").classList.remove("show");
    if ($("doneCard")) $("doneCard").classList.add("show");

    if (lastChimedJobId !== dl.jobId) {
      lastChimedJobId = dl.jobId;
      playSuccessChime();
    }

    const fname = dl.filename || dl.title || "Video";
    if ($("doneFilename")) $("doneFilename").textContent = fname;

    currentDoneJobId = dl.jobId;

    if ($("donePlayBtn")) {
      $("donePlayBtn").onclick = () => {
        chrome.tabs.create({ url: `${API_BASE}/?play=${encodeURIComponent(dl.filename || dl.title || "")}` });
      };
    }

    document.querySelectorAll(".fmt-btn").forEach(b => b.disabled = false);
    refreshHistBadge();

    // Reset in-page button
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { action: "PROGRESS_TICK", data: dl }).catch(() => {});
    });

  } else if (dl.status === "error") {
    if ($("progressCard")) $("progressCard").classList.remove("show");
    document.querySelectorAll(".fmt-btn").forEach(b => b.disabled = false);
  }
}

// ── Message Listener ──────────────────────────────────────────────
function setupMessageListener() {
  chrome.runtime.onMessage.addListener(msg => {
    if (msg.action === "PROGRESS_TICK" && msg.data) {
      renderActiveDownload(msg.data);
    }
    if (msg.action === "QUEUE_UPDATE") {
      const q = msg.queue || [];
      const badge = $("histBadge");
      // Show queue count on History badge temporarily
      if (q.length > 0 && badge) {
        badge.textContent = `+${q.length}`;
        badge.classList.add("on");
      }
    }
  });
}

// ── Open Folder ───────────────────────────────────────────────────
async function openDownloadsFolder() {
  try { await fetch(`${API_BASE}/api/open-downloads`, { method: "POST" }); } catch {}
}

// ── QR Code ───────────────────────────────────────────────────────
function showQrCode() {
  if (!currentDoneJobId) return;
  const streamUrl = `${API_BASE}/api/file/${currentDoneJobId}`;
  if ($("qrCard")) $("qrCard").classList.add("show");
  const canvas = $("qrCanvas");
  if (canvas && window.generateQR) window.generateQR(streamUrl, canvas);
}

// ── History Tab ───────────────────────────────────────────────────
let _allFiles = [];

async function loadHistory() {
  const list = $("dlList");
  if (!list) return;
  list.innerHTML = '<div class="hist-empty">Loading…</div>';

  try {
    const res = await fetch(`${API_BASE}/api/history`);
    if (!res.ok) throw new Error("Offline");
    const data = await res.json();
    _allFiles = data.files || [];

    if ($("histTotal")) $("histTotal").textContent = data.total_files || 0;
    if ($("histSize")) $("histSize").textContent = data.total_size || "0 B";

    const badge = $("histBadge");
    if (badge) {
      badge.textContent = _allFiles.length;
      badge.classList.toggle("on", _allFiles.length > 0);
    }

    renderHistoryList(_allFiles);
  } catch {
    list.innerHTML = '<div class="hist-empty" style="color:#f87171;">Backend Offline — Start start_app.bat</div>';
  }
}

function renderHistoryList(files) {
  const list = $("dlList");
  if (!list) return;
  if (!files.length) {
    list.innerHTML = '<div class="hist-empty">No downloads yet.<br>Download a video and it will appear here.</div>';
    return;
  }
  list.innerHTML = "";
  files.forEach(f => {
    const icon = f.is_audio ? "🎵" : "🎬";
    const ext = (f.ext || "").replace(".", "").toUpperCase();
    const row = document.createElement("div");
    row.className = "dl-row";
    row.innerHTML = `
      <div class="dl-ico">${icon}</div>
      <div class="dl-left">
        <div class="dl-name" title="${escHtml(f.name)}">${escHtml(f.name)}</div>
        <div class="dl-meta">${f.size} • ${ext}</div>
      </div>
      <div class="dl-acts">
        <button class="dl-act play" title="Play">▶</button>
        <button class="dl-act qr" title="QR Share">📱</button>
        <button class="dl-act folder" title="Open Folder">📁</button>
        <button class="dl-act del" title="Delete">🗑</button>
      </div>
    `;

    row.querySelector(".play").onclick = () =>
      chrome.tabs.create({ url: `${API_BASE}/?play=${encodeURIComponent(f.name)}` });

    row.querySelector(".qr").onclick = () => {
      switchToDownloadTab();
      if ($("qrCard")) $("qrCard").classList.add("show");
      if ($("doneCard")) $("doneCard").classList.remove("show");
      const canvas = $("qrCanvas");
      if (canvas && window.generateQR) window.generateQR(`${API_BASE}${f.stream_url}`, canvas);
    };

    row.querySelector(".folder").onclick = async () => {
      try { await fetch(`${API_BASE}/api/open-file/${encodeURIComponent(f.name)}`, { method: "POST" }); } catch {}
    };

    row.querySelector(".del").onclick = async () => {
      if (!confirm(`Delete "${f.name}"?`)) return;
      try {
        const r = await fetch(`${API_BASE}/api/file/${encodeURIComponent(f.name)}`, { method: "DELETE" });
        if (r.ok) loadHistory();
      } catch {}
    };

    list.appendChild(row);
  });
}

function filterHistory() {
  const q = $("histSearch")?.value.toLowerCase() || "";
  renderHistoryList(_allFiles.filter(f => f.name.toLowerCase().includes(q)));
}

async function refreshHistBadge() {
  try {
    const res = await fetch(`${API_BASE}/api/history`);
    if (!res.ok) return;
    const data = await res.json();
    const badge = $("histBadge");
    if (badge) {
      badge.textContent = data.total_files || 0;
      badge.classList.toggle("on", (data.total_files || 0) > 0);
    }
  } catch {}
}

// ── Settings / Diagnostics ────────────────────────────────────────
async function loadDiagnostics() {
  if ($('diagStatus')) $('diagStatus').textContent = 'Checking…';
  try {
    const res = await fetch(`${API_BASE}/api/status`);
    const data = await res.json();
    if ($('diagStatus')) { $('diagStatus').textContent = '✓ Online'; $('diagStatus').className = 'diag-v ok'; }
    if ($('diagYtdlp')) $('diagYtdlp').textContent = data.ytdlp_version || data.yt_dlp || 'Available';
    if ($('diagFfmpeg')) {
      $('diagFfmpeg').textContent = data.ffmpeg ? '✓ Found' : '✗ Missing';
      $('diagFfmpeg').className = `diag-v ${data.ffmpeg ? 'ok' : 'err'}`;
    }
    if ($('diagFolder')) $('diagFolder').textContent = data.download_dir || '~/Downloads/ZDownloader';
    // Show current folder in settings
    if ($('currentFolderLabel')) $('currentFolderLabel').textContent = data.download_dir || 'Default';
    if ($('customFolderInput') && !$('customFolderInput').value) {
      $('customFolderInput').placeholder = data.download_dir || 'Enter custom path...';
    }
  } catch {
    if ($('diagStatus')) { $('diagStatus').textContent = '✗ Offline'; $('diagStatus').className = 'diag-v err'; }
    if ($('currentFolderLabel')) $('currentFolderLabel').textContent = 'Backend offline';
  }
}

// ── Utility ───────────────────────────────────────────────────────
function escHtml(str) {
  return (str || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// ── Page Media Sniffer & Batch Downloader ─────────────────────────
async function scanAndRenderPageMedia() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || tab.url.startsWith("chrome://") || tab.url.startsWith("edge://")) return;

    chrome.tabs.sendMessage(tab.id, { action: "SCAN_PAGE_MEDIA" }, response => {
      if (chrome.runtime.lastError || !response || !response.items || response.items.length < 2) {
        if ($("pageMediaSection")) $("pageMediaSection").style.display = "none";
        return;
      }

      const items = response.items;
      const sec = $("pageMediaSection");
      const cnt = $("pageMediaCount");
      const list = $("pageMediaList");
      const allBtn = $("batchDlAllBtn");
      const toggle = $("pageMediaToggle");

      if (cnt) cnt.textContent = items.length;
      if (sec) sec.style.display = "block";

      if (toggle && list) {
        toggle.onclick = (e) => {
          if (e.target.closest("#batchDlAllBtn")) return;
          const open = list.style.display === "flex";
          list.style.display = open ? "none" : "flex";
        };
      }

      if (list) {
        list.innerHTML = "";
        items.forEach(it => {
          const row = document.createElement("div");
          row.className = "batch-item";
          row.innerHTML = `
            <span style="font-size:12px;">🎬</span>
            <span class="batch-item-title" title="${escHtml(it.title)}">${escHtml(it.title)}</span>
          `;
          list.appendChild(row);
        });
      }

      if (allBtn) {
        allBtn.onclick = (e) => {
          e.stopPropagation();
          allBtn.textContent = "⏳ Queueing…";
          allBtn.disabled = true;
          chrome.runtime.sendMessage({
            action: "BATCH_ENQUEUE",
            items: items.map(it => ({ url: it.url, title: it.title, turbo: !!settings.turbo }))
          }, res => {
            allBtn.textContent = `✅ ${res?.queued || items.length} Queued!`;
            setTimeout(() => {
              allBtn.textContent = "⚡ Download All";
              allBtn.disabled = false;
            }, 3000);
          });
        };
      }
    });
  } catch {}
}

// ── Audio Success Chime (Web Audio API) ───────────────────────────
function playSuccessChime() {
  if (settings.sound === false) return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    // Tone 1: 587.33 Hz (D5)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(587.33, now);
    gain1.gain.setValueAtTime(0.12, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.3);

    // Tone 2: 880.00 Hz (A5)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(880.00, now + 0.12);
    gain2.gain.setValueAtTime(0.14, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.5);
  } catch (e) {}
}
