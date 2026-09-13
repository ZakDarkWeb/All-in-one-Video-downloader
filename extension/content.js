// ZDownloader PRO by Basit — Clean Media Detector v5.0
// Pure background link & media detection for Extension Popup & Context Menus
// Zero on-page visual injection (100% clean, distraction-free browsing)

(function () {
  function isCtxValid() {
    try { return !!chrome.runtime?.id; } catch { return false; }
  }
  if (!isCtxValid()) return;
  if (window.__zakInjected) return;
  window.__zakInjected = true;

  // Clean up any existing floating elements if present
  const existingHost = document.getElementById("zak-fab-host");
  if (existingHost) existingHost.remove();
  const existingFab = document.getElementById("zak-fab");
  if (existingFab) existingFab.remove();

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
        const ttLink  = lastRightClickedEl.closest('a[href*="/video/"], a[href*="/@"]');
        const twLink  = lastRightClickedEl.closest('a[href*="/status/"]');
        const redLink = lastRightClickedEl.closest('a[href*="/comments/"], a[href*="/r/"]');
        const fbLink  = lastRightClickedEl.closest('a[href*="/watch/"], a[href*="/videos/"], a[href*="/reel/"]');
        if (ytLink?.href)  url = ytLink.href;
        if (pinLink?.href) url = url || pinLink.href;
        if (igLink?.href)  url = url || igLink.href;
        if (ttLink?.href)  url = url || ttLink.href;
        if (twLink?.href)  url = url || twLink.href;
        if (redLink?.href) url = url || redLink.href;
        if (fbLink?.href)  url = url || fbLink.href;
      }
      sendResponse({ url: url || window.location.href });
      return false;
    }
    if (msg.action === "SCAN_PAGE_MEDIA") {
      const items = scanPageMedia();
      sendResponse({ ok: true, items: items });
      return false;
    }
  });

  // ── Scan All Media on Page for Extension Popup / Batch Downloader ──
  function scanPageMedia() {
    const found = [];
    const seen = new Set();

    function addItem(url, title, plat, thumb) {
      if (!url || seen.has(url)) return;
      if (url.startsWith("blob:") || url.startsWith("chrome://") || url.startsWith("edge://")) return;
      if (!url.startsWith("http")) return;
      seen.add(url);
      found.push({
        url: url,
        title: (title || "Video").slice(0, 70).trim(),
        platform: plat || "Media",
        thumbnail: thumb || ""
      });
    }

    // 1. YouTube links
    document.querySelectorAll('a[href*="/watch?v="], a[href*="/shorts/"]').forEach(a => {
      let u = a.href.split("&")[0];
      const title = a.title || a.textContent.trim() || a.getAttribute("aria-label") || "YouTube Video";
      const img = a.querySelector("img");
      if (title && title.length > 3) addItem(u, title, "YouTube", img?.src || "");
    });

    // 2. Pinterest pins
    document.querySelectorAll('a[href*="/pin/"]').forEach(a => {
      const img = a.querySelector("img");
      const title = img?.alt || a.textContent.trim() || "Pinterest Pin";
      addItem(a.href, title, "Pinterest", img?.src || "");
    });

    // 3. Instagram reels / posts
    document.querySelectorAll('a[href*="/reel/"], a[href*="/p/"]').forEach(a => {
      const img = a.querySelector("img");
      addItem(a.href, "Instagram Media", "Instagram", img?.src || "");
    });

    // 4. TikTok links
    document.querySelectorAll('a[href*="/video/"]').forEach(a => {
      addItem(a.href, "TikTok Video", "TikTok", "");
    });

    // 5. HTML5 video elements
    document.querySelectorAll("video").forEach((v, idx) => {
      let src = v.currentSrc || v.src;
      if (!src) {
        const source = v.querySelector("source");
        if (source) src = source.src;
      }
      if (src && src.startsWith("http")) {
        addItem(src, `Video Clip #${idx + 1}`, "Web Video", v.poster || "");
      }
    });

    return found.slice(0, 30);
  }
})();
