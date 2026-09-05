// ZDownloader by Zak — In-Page Content Script v3.2
// Features: Draggable FAB, Progress Ring, Chrome Notifications

(function () {
  function isCtxValid() {
    try { return !!chrome.runtime?.id; } catch { return false; }
  }
  if (!isCtxValid()) return;
  if (window.__zakInjected) return;
  window.__zakInjected = true;

  let isDownloading = false;
  let fabPos = { x: null, y: null }; // saved position

  // ── Context Menu tracking ──────────────────────────────────────
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
      sendResponse({ url: url || window.location.href });
      return false;
    }
    if (msg.action === "PROGRESS_TICK" && msg.data) {
      updateFAB(msg.data);
    }
  });

  // ── Inject FAB ────────────────────────────────────────────────
  function injectFAB() {
    if (document.getElementById("zak-fab")) return;

    const host = window.location.hostname;
    const path = window.location.pathname;

    const isYT      = host.includes("youtube.com") && (path.includes("/watch") || path.includes("/shorts/"));
    const isIG      = host.includes("instagram.com") && (path.includes("/reel/") || path.includes("/p/"));
    const isTikTok  = host.includes("tiktok.com");
    const isFB      = host.includes("facebook.com");
    const isTwitter = host.includes("twitter.com") || host.includes("x.com");
    const isPin     = host.includes("pinterest.com") || host.includes("pin.it");
    const isSnap    = host.includes("snapchat.com");

    if (!isYT && !isIG && !isTikTok && !isFB && !isTwitter && !isPin && !isSnap) return;
    if (!isYT && !document.querySelector("video")) return;

    // ── Build FAB HTML ──
    const fab = document.createElement("div");
    fab.id = "zak-fab";

    fab.innerHTML = `
      <div id="zak-fab-menu">
        <div class="zak-menu-header">
          <svg viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
          ZDownloader
        </div>
        <button class="zak-menu-row zak-row-best" data-q="best" data-audio="false">
          <span class="zak-menu-icon">⭐</span>
          <span class="zak-menu-txt">Best Quality</span>
          <span class="zak-menu-tag zak-tag-hot">Auto-HD</span>
        </button>
        <button class="zak-menu-row" data-q="1080" data-audio="false">
          <span class="zak-menu-icon">🎬</span>
          <span class="zak-menu-txt">1080p MP4</span>
          <span class="zak-menu-tag">Full HD</span>
        </button>
        <button class="zak-menu-row" data-q="720" data-audio="false">
          <span class="zak-menu-icon">🎬</span>
          <span class="zak-menu-txt">720p MP4</span>
          <span class="zak-menu-tag">HD</span>
        </button>
        <button class="zak-menu-row" data-q="480" data-audio="false">
          <span class="zak-menu-icon">🎬</span>
          <span class="zak-menu-txt">480p MP4</span>
          <span class="zak-menu-tag">SD</span>
        </button>
        <button class="zak-menu-row zak-row-audio" data-q="best" data-audio="true">
          <span class="zak-menu-icon">🎧</span>
          <span class="zak-menu-txt">MP3 Audio</span>
          <span class="zak-menu-tag zak-tag-audio">320kbps</span>
        </button>
      </div>

      <div id="zak-fab-btn-wrap">
        <svg id="zak-ring-svg" viewBox="0 0 52 52">
          <circle id="zak-ring-track" cx="26" cy="26" r="22" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="3"/>
          <circle id="zak-ring-fill"  cx="26" cy="26" r="22" fill="none" stroke="url(#zak-grad)" stroke-width="3"
            stroke-linecap="round" stroke-dasharray="138.2" stroke-dashoffset="138.2"
            transform="rotate(-90 26 26)"/>
          <defs>
            <linearGradient id="zak-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#00d4ff"/>
              <stop offset="100%" stop-color="#8b5cf6"/>
            </linearGradient>
          </defs>
        </svg>
        <button id="zak-fab-btn" title="ZDownloader — Click to download">
          <svg class="zak-dl-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          <span id="zak-fab-label">Download</span>
        </button>
        <div id="zak-drag-handle" title="Drag to move">⠿</div>
      </div>
    `;

    document.documentElement.appendChild(fab);

    // ── Restore saved position ──
    try {
      const saved = JSON.parse(sessionStorage.getItem("zak_fab_pos") || "null");
      if (saved) {
        fab.style.bottom = "auto";
        fab.style.right  = "auto";
        fab.style.top    = saved.top + "px";
        fab.style.left   = saved.left + "px";
      }
    } catch {}

    const fabBtn    = document.getElementById("zak-fab-btn");
    const fabMenu   = document.getElementById("zak-fab-menu");
    const fabLabel  = document.getElementById("zak-fab-label");
    const ringFill  = document.getElementById("zak-ring-fill");
    const dragHandle = document.getElementById("zak-drag-handle");
    const CIRCUMFERENCE = 138.2;

    // ── Toggle menu ──
    fabBtn.addEventListener("click", e => {
      e.stopPropagation();
      if (isDownloading) return;
      fabMenu.classList.toggle("zak-open");
      fabBtn.classList.toggle("zak-active");
    });

    document.addEventListener("click", e => {
      if (!fab.contains(e.target)) {
        fabMenu.classList.remove("zak-open");
        fabBtn.classList.remove("zak-active");
      }
    }, true);

    // ── Menu item clicks ──
    fab.querySelectorAll(".zak-menu-row").forEach(item => {
      item.addEventListener("click", e => {
        e.stopPropagation();
        e.preventDefault();
        fabMenu.classList.remove("zak-open");
        fabBtn.classList.remove("zak-active");
        if (isDownloading) return;
        const q     = item.getAttribute("data-q");
        const audio = item.getAttribute("data-audio") === "true";
        startDownload(q, audio);
      });
    });

    // ── Draggable ──
    makeDraggable(fab, dragHandle);

    // ── Download function ──
    function startDownload(quality, audioOnly) {
      if (!isCtxValid()) {
        fabLabel.textContent = "🔄 Refresh";
        setTimeout(() => { fabLabel.textContent = "Download"; }, 3000);
        return;
      }

      isDownloading = true;
      fabBtn.classList.add("zak-busy");
      setRingProgress(0);
      fabLabel.textContent = "⚡ Starting…";

      chrome.runtime.sendMessage({
        action: "START_DOWNLOAD",
        url: window.location.href,
        quality,
        audioOnly,
        title: document.title.replace(/ - YouTube$/, "").replace(/ • Instagram$/, "").trim()
      }, response => {
        if (chrome.runtime.lastError || !response || !response.ok) {
          const err = response?.error || "Failed";
          fabLabel.textContent = "❌ " + err;
          fabBtn.classList.remove("zak-busy");
          setRingProgress(0);
          isDownloading = false;
          setTimeout(() => { fabLabel.textContent = "Download"; }, 3000);
        }
        // Progress comes via PROGRESS_TICK messages
      });
    }

    function setRingProgress(pct) {
      if (!ringFill) return;
      const offset = CIRCUMFERENCE - (pct / 100) * CIRCUMFERENCE;
      ringFill.style.strokeDashoffset = offset;
    }

    // Expose updateFAB to outer scope
    window.__zakUpdateFAB = function(dl) {
      const pct = Math.round(dl.progress || 0);
      if (dl.status === "starting") {
        fabLabel.textContent = "⚡ Starting…";
        setRingProgress(0);
      } else if (dl.status === "downloading") {
        fabLabel.textContent = `⬇ ${pct}%`;
        setRingProgress(pct);
        fabBtn.classList.add("zak-busy");
      } else if (dl.status === "processing") {
        fabLabel.textContent = "⚙️ Merging…";
        setRingProgress(95);
      } else if (dl.status === "done") {
        fabLabel.textContent = "✅ Done!";
        setRingProgress(100);
        fabBtn.classList.remove("zak-busy");
        fabBtn.classList.add("zak-done");
        isDownloading = false;
        setTimeout(() => {
          fabLabel.textContent = "Download";
          setRingProgress(0);
          fabBtn.classList.remove("zak-done");
        }, 4000);
      } else if (dl.status === "error") {
        fabLabel.textContent = "❌ Error";
        setRingProgress(0);
        fabBtn.classList.remove("zak-busy");
        isDownloading = false;
        setTimeout(() => { fabLabel.textContent = "Download"; }, 3000);
      }
    };
  }

  function updateFAB(dl) {
    if (window.__zakUpdateFAB) window.__zakUpdateFAB(dl);
  }

  // ── Draggable logic ────────────────────────────────────────────
  function makeDraggable(el, handle) {
    let startX, startY, startLeft, startTop, dragging = false;

    handle.addEventListener("mousedown", e => {
      e.preventDefault();
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

      // Clamp to viewport
      newLeft = Math.max(8, Math.min(window.innerWidth  - el.offsetWidth  - 8, newLeft));
      newTop  = Math.max(8, Math.min(window.innerHeight - el.offsetHeight - 8, newTop));

      el.style.left = newLeft + "px";
      el.style.top  = newTop  + "px";
    });

    document.addEventListener("mouseup", () => {
      if (!dragging) return;
      dragging = false;
      el.classList.remove("zak-dragging");
      el.style.transition = "";

      // Save position
      try {
        sessionStorage.setItem("zak_fab_pos", JSON.stringify({
          top: parseInt(el.style.top),
          left: parseInt(el.style.left)
        }));
      } catch {}
    });
  }

  // ── Init ──────────────────────────────────────────────────────
  function init() {
    if (!isCtxValid()) return;
    setTimeout(injectFAB, 600);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // YouTube SPA
  window.addEventListener("yt-navigate-finish", () => {
    const old = document.getElementById("zak-fab");
    if (old) old.remove();
    window.__zakUpdateFAB = null;
    window.__zakInjected = false;
    setTimeout(init, 800);
  });

  // Generic SPA — watch for URL changes
  let _lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== _lastUrl) {
      _lastUrl = location.href;
      const old = document.getElementById("zak-fab");
      if (old) old.remove();
      window.__zakUpdateFAB = null;
      window.__zakInjected = false;
      setTimeout(init, 800);
    }
  }).observe(document.body || document.documentElement, { subtree: true, childList: true });

})();
