// ZDownloader PRO by Zak — In-Page Smart Floating Card v4.0
// Features: Compact Glass Pill, Expandable Luxury Card, Real-time Progress, Multi-Platform Hover Detection

(function () {
  function isCtxValid() {
    try { return !!chrome.runtime?.id; } catch { return false; }
  }
  if (!isCtxValid()) return;
  if (window.__zakInjected) return;
  window.__zakInjected = true;

  let isDownloading = false;
  let detectedVideo = {
    url: window.location.href,
    title: document.title.replace(/ - YouTube$/, "").replace(/ • Instagram$/, "").trim() || "Web Video",
    platform: "Video"
  };

  // ── Context Menu Tracking ──────────────────────────────────────────
  let lastRightClickedEl = null;
  document.addEventListener("contextmenu", e => { lastRightClickedEl = e.target; }, true);

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!isCtxValid()) return;
    if (msg.action === "GET_CONTEXT_URL") {
      let url = "";
      if (lastRightClickedEl) {
        const ytLink  = lastRightClickedEl.closest('a[href*="/watch"], a[href*="/shorts/"]');
        const pinLink = lastRightClickedEl.closest('a[href*="/pin/"]');
        const igLink  = lastRightClickedEl.closest('a[href*="/reel/"], a[href*="/p/"]');
        if (ytLink?.href)  url = ytLink.href;
        if (pinLink?.href) url = url || pinLink.href;
        if (igLink?.href)  url = url || igLink.href;
      }
      sendResponse({ url: url || detectedVideo.url || window.location.href });
      return false;
    }
    if (msg.action === "PROGRESS_TICK" && msg.data) {
      updateProgress(msg.data);
    }
  });

  // ── Smart Video Detection ─────────────────────────────────────────
  function detectPlatform() {
    const host = window.location.hostname.toLowerCase();
    const path = window.location.pathname.toLowerCase();

    if (host.includes("youtube.com")) {
      if (path.includes("/watch") || path.includes("/shorts/")) return "YouTube";
      return null;
    }
    if (host.includes("instagram.com")) return "Instagram";
    if (host.includes("pinterest.com") || host.includes("pin.it")) return "Pinterest";
    if (host.includes("tiktok.com")) return "TikTok";
    if (host.includes("facebook.com")) return "Facebook";
    if (host.includes("twitter.com") || host.includes("x.com")) return "Twitter / X";
    if (document.querySelector("video")) return "Web Video";
    return null;
  }

  function updateVideoContext() {
    const plat = detectPlatform();
    if (!plat) return false;

    detectedVideo.platform = plat;
    let url = window.location.href;
    let title = document.title.replace(/ - YouTube$/, "").replace(/ • Instagram$/, "").trim() || "Detected Video";

    // Platform-specific smart extraction
    if (plat === "YouTube") {
      const ytTitle = document.querySelector("h1.ytd-watch-metadata, #title h1, yt-formatted-string.ytd-video-primary-info-renderer");
      if (ytTitle && ytTitle.textContent.trim()) title = ytTitle.textContent.trim();
    } else if (plat === "Pinterest") {
      // Check if viewing a specific pin or focused pin in feed
      const activePin = document.querySelector('[data-test-id="pin-title"], [data-test-id="rich-pin-title"], h1');
      if (activePin && activePin.textContent.trim()) title = activePin.textContent.trim();
    } else if (plat === "Instagram") {
      const igCaption = document.querySelector("h1, article header + div span, div._a9zs");
      if (igCaption && igCaption.textContent.trim()) title = igCaption.textContent.trim().slice(0, 70);
    }

    detectedVideo.url = url;
    detectedVideo.title = title;
    return true;
  }

  // Track hover on feed items (e.g. Pinterest pins, Insta reels in grid)
  document.addEventListener("mouseover", e => {
    if (isDownloading) return;
    const pinLink = e.target.closest('a[href*="/pin/"]');
    if (pinLink && pinLink.href) {
      detectedVideo.url = pinLink.href;
      detectedVideo.platform = "Pinterest";
      const img = pinLink.querySelector("img");
      if (img && img.alt) detectedVideo.title = img.alt.slice(0, 60);
      refreshCardUI();
      return;
    }

    const reelLink = e.target.closest('a[href*="/reel/"]');
    if (reelLink && reelLink.href) {
      detectedVideo.url = reelLink.href;
      detectedVideo.platform = "Instagram";
      refreshCardUI();
    }
  }, { passive: true });

  // ── Inject Floating Widget ─────────────────────────────────────────
  function injectWidget() {
    if (document.getElementById("zak-fab")) return;
    if (!updateVideoContext()) return;

    const fab = document.createElement("div");
    fab.id = "zak-fab";

    fab.innerHTML = `
      <!-- COMPACT PILL STATE -->
      <div id="zak-fab-pill" title="Click to view download options">
        <div class="zak-pill-logo">
          <svg viewBox="0 0 24 24"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
        </div>
        <div class="zak-pill-info">
          <div class="zak-pill-title">
            <span id="zak-pill-plat">${detectedVideo.platform}</span>
            <span class="zak-pill-tag">AUTO-HD</span>
          </div>
          <div class="zak-pill-sub">Click to Download</div>
        </div>
        <div class="zak-drag-handle" title="Drag anywhere">⠿</div>
      </div>

      <!-- EXPANDED CARD STATE -->
      <div id="zak-fab-card">
        <div class="zak-card-header">
          <div class="zak-card-brand">
            <div class="zak-card-brand-logo">
              <svg viewBox="0 0 24 24"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
            </div>
            <span class="zak-card-title-text">ZDownloader PRO</span>
          </div>
          <div class="zak-card-actions">
            <div class="zak-btn-icon zak-drag-handle" title="Drag to reposition">⠿</div>
            <div class="zak-btn-icon" id="zak-close-card" title="Minimize">✕</div>
          </div>
        </div>

        <div class="zak-card-video-info">
          <div class="zak-video-badge-row">
            <span class="zak-platform-tag" id="zak-card-plat-badge">🎬 ${detectedVideo.platform}</span>
          </div>
          <div class="zak-video-name" id="zak-card-video-name">${escapeHtml(detectedVideo.title)}</div>
        </div>

        <div class="zak-card-options">
          <button class="zak-dl-main-btn" id="zak-btn-best" data-q="best" data-audio="false">
            <span class="zak-btn-left">
              <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
              Best Quality
            </span>
            <span class="zak-pill-badge-hot">⚡ 1-Click</span>
          </button>

          <div class="zak-sub-grid">
            <button class="zak-sub-btn" data-q="1080" data-audio="false">
              <span>🎬</span> 1080p MP4
            </button>
            <button class="zak-sub-btn" data-q="720" data-audio="false">
              <span>🎬</span> 720p MP4
            </button>
            <button class="zak-sub-btn zak-audio" data-q="best" data-audio="true">
              <span>🎧</span> MP3 Audio (320kbps)
            </button>
          </div>
        </div>
      </div>

      <!-- LIVE PROGRESS STATE -->
      <div id="zak-fab-progress">
        <div class="zak-prog-top">
          <span class="zak-prog-status" id="zak-prog-status">⚡ Initializing...</span>
          <span class="zak-prog-pct" id="zak-prog-pct">0%</span>
        </div>
        <div class="zak-prog-bar-track">
          <div class="zak-prog-bar-fill" id="zak-prog-fill"></div>
        </div>
        <div class="zak-prog-sub">
          <span id="zak-prog-speed">Connecting...</span>
          <span id="zak-prog-eta">ETA --</span>
        </div>
      </div>
    `;

    document.documentElement.appendChild(fab);

    // Restore saved position
    try {
      const saved = JSON.parse(sessionStorage.getItem("zak_fab_pos_v4") || "null");
      if (saved) {
        fab.style.bottom = "auto";
        fab.style.right  = "auto";
        fab.style.top    = saved.top + "px";
        fab.style.left   = saved.left + "px";
      }
    } catch {}

    // ── Bind Event Listeners ──
    const pill = document.getElementById("zak-fab-pill");
    const closeBtn = document.getElementById("zak-close-card");

    pill.addEventListener("click", e => {
      if (e.target.closest(".zak-drag-handle")) return;
      if (isDownloading) return;
      updateVideoContext();
      refreshCardUI();
      fab.classList.add("zak-expanded");
    });

    closeBtn.addEventListener("click", e => {
      e.stopPropagation();
      fab.classList.remove("zak-expanded");
    });

    // Close when clicking outside
    document.addEventListener("click", e => {
      if (!fab.contains(e.target)) {
        fab.classList.remove("zak-expanded");
      }
    }, true);

    // Download buttons
    fab.querySelectorAll("[data-q]").forEach(btn => {
      btn.addEventListener("click", e => {
        e.stopPropagation();
        e.preventDefault();
        if (isDownloading) return;
        const q = btn.getAttribute("data-q");
        const audio = btn.getAttribute("data-audio") === "true";
        startDownload(q, audio);
      });
    });

    // Draggable
    fab.querySelectorAll(".zak-drag-handle").forEach(handle => {
      makeDraggable(fab, handle);
    });
  }

  function escapeHtml(str) {
    return (str || "").replace(/[&<>"']/g, m => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[m]);
  }

  function refreshCardUI() {
    const platText = document.getElementById("zak-pill-plat");
    const platBadge = document.getElementById("zak-card-plat-badge");
    const titleText = document.getElementById("zak-card-video-name");

    if (platText) platText.textContent = detectedVideo.platform;
    if (platBadge) platBadge.textContent = "🎬 " + detectedVideo.platform;
    if (titleText) titleText.textContent = detectedVideo.title;
  }

  // ── Download Trigger ──────────────────────────────────────────────
  function startDownload(quality, audioOnly) {
    if (!isCtxValid()) return;

    const fab = document.getElementById("zak-fab");
    if (!fab) return;

    isDownloading = true;
    fab.classList.remove("zak-expanded");
    fab.classList.add("zak-downloading");

    const statusEl = document.getElementById("zak-prog-status");
    const pctEl = document.getElementById("zak-prog-pct");
    const fillEl = document.getElementById("zak-prog-fill");

    if (statusEl) statusEl.textContent = "⚡ Starting Engine...";
    if (pctEl) pctEl.textContent = "0%";
    if (fillEl) fillEl.style.width = "0%";

    chrome.runtime.sendMessage({
      action: "START_DOWNLOAD",
      url: detectedVideo.url || window.location.href,
      quality,
      audioOnly,
      title: detectedVideo.title
    }, response => {
      if (chrome.runtime.lastError || !response || !response.ok) {
        const err = response?.error || "Download Failed";
        if (statusEl) statusEl.textContent = "❌ " + err;
        setTimeout(() => {
          fab.classList.remove("zak-downloading");
          isDownloading = false;
        }, 3500);
      }
    });
  }

  // ── Progress Update Handler ───────────────────────────────────────
  function updateProgress(data) {
    const fab = document.getElementById("zak-fab");
    if (!fab) return;

    const statusEl = document.getElementById("zak-prog-status");
    const pctEl = document.getElementById("zak-prog-pct");
    const fillEl = document.getElementById("zak-prog-fill");
    const speedEl = document.getElementById("zak-prog-speed");
    const etaEl = document.getElementById("zak-prog-eta");

    const pct = Math.round(data.progress || 0);

    if (data.status === "starting") {
      if (statusEl) statusEl.textContent = "⚡ Initializing...";
      if (pctEl) pctEl.textContent = "0%";
      if (fillEl) fillEl.style.width = "5%";
    } else if (data.status === "downloading") {
      if (statusEl) statusEl.textContent = "⬇ Downloading...";
      if (pctEl) pctEl.textContent = pct + "%";
      if (fillEl) fillEl.style.width = pct + "%";
      if (speedEl && data.speed) speedEl.textContent = `⚡ ${data.speed}`;
      if (etaEl && data.eta) etaEl.textContent = `ETA: ${data.eta}`;
    } else if (data.status === "processing") {
      if (statusEl) statusEl.textContent = "⚙️ Merging Video...";
      if (pctEl) pctEl.textContent = "95%";
      if (fillEl) fillEl.style.width = "95%";
    } else if (data.status === "done") {
      if (statusEl) {
        statusEl.textContent = "✅ Download Complete!";
        statusEl.classList.add("zak-prog-done");
      }
      if (pctEl) pctEl.textContent = "100%";
      if (fillEl) fillEl.style.width = "100%";
      if (speedEl) speedEl.textContent = "Saved to Downloads";
      if (etaEl) etaEl.textContent = "ZDownloader";

      setTimeout(() => {
        fab.classList.remove("zak-downloading");
        if (statusEl) statusEl.classList.remove("zak-prog-done");
        isDownloading = false;
      }, 4000);
    } else if (data.status === "error") {
      if (statusEl) statusEl.textContent = "❌ " + (data.error || "Error");
      setTimeout(() => {
        fab.classList.remove("zak-downloading");
        isDownloading = false;
      }, 3500);
    }
  }

  // ── Draggable Implementation ──────────────────────────────────────
  function makeDraggable(el, handle) {
    let startX, startY, startLeft, startTop, dragging = false;

    handle.addEventListener("mousedown", e => {
      e.preventDefault();
      e.stopPropagation();
      dragging = true;
      const rect = el.getBoundingClientRect();
      startX    = e.clientX;
      startY    = e.clientY;
      startLeft = rect.left;
      startTop  = rect.top;

      el.style.transition = "none";
      el.style.bottom = "auto";
      el.style.right  = "auto";
      el.style.top    = startTop + "px";
      el.style.left   = startLeft + "px";
      el.classList.add("zak-dragging");
    });

    document.addEventListener("mousemove", e => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      let newLeft = startLeft + dx;
      let newTop  = startTop  + dy;

      // Clamp to viewport boundaries
      newLeft = Math.max(10, Math.min(window.innerWidth - el.offsetWidth - 10, newLeft));
      newTop  = Math.max(10, Math.min(window.innerHeight - el.offsetHeight - 10, newTop));

      el.style.left = newLeft + "px";
      el.style.top  = newTop  + "px";
    });

    document.addEventListener("mouseup", () => {
      if (!dragging) return;
      dragging = false;
      el.classList.remove("zak-dragging");
      el.style.transition = "";

      try {
        sessionStorage.setItem("zak_fab_pos_v4", JSON.stringify({
          top: parseInt(el.style.top),
          left: parseInt(el.style.left)
        }));
      } catch {}
    });
  }

  // ── Init & SPA Listeners ──────────────────────────────────────────
  function init() {
    if (!isCtxValid()) return;
    setTimeout(injectWidget, 500);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // YouTube SPA finish
  window.addEventListener("yt-navigate-finish", () => {
    const old = document.getElementById("zak-fab");
    if (old) old.remove();
    window.__zakInjected = false;
    setTimeout(init, 700);
  });

  // Generic SPA URL watcher
  let _lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== _lastUrl) {
      _lastUrl = location.href;
      const old = document.getElementById("zak-fab");
      if (old) old.remove();
      window.__zakInjected = false;
      setTimeout(init, 700);
    }
  }).observe(document.body || document.documentElement, { subtree: true, childList: true });

})();
