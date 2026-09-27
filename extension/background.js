const API_BASE = "http://127.0.0.1:8000";

let activeDownload = null;
let pollTimer = null;
let _lastDoneNotifId = null; // BUG FIX: track done notif ID at top level

// ── Download Queue ─────────────────────────────────────────────
let downloadQueue = []; // [{url, quality, audioOnly, title, thumbnail}]

function startNextInQueue() {
  if (downloadQueue.length === 0) return;
  const next = downloadQueue.shift();
  chrome.runtime.sendMessage({ action: "QUEUE_UPDATE", queue: downloadQueue }).catch(() => {});
  setTimeout(() => {
    startDownload(next.url, next.quality, next.audioOnly, next.title, next.startTime, next.endTime, next.thumbnail)
      .catch(() => {});
  }, 800);
}

function sanitizeFilename(name) {
  return (name || "video").replace(/[\\/:*?"<>|]/g, "_").trim().slice(0, 100);
}

// BUG FIX: Notification button listener at TOP LEVEL (not inside pollJob).
// Previously it was added inside pollJob on every completion → listener leak.
chrome.notifications.onButtonClicked.addListener((nId, btnIdx) => {
  if (nId === _lastDoneNotifId && btnIdx === 0) {
    fetch(`${API_BASE}/api/open-downloads`, { method: "POST" }).catch(() => {});
  }
});

// Setup Rich Context Menus
chrome.runtime.onInstalled.addListener(setupContextMenus);
chrome.runtime.onStartup.addListener(setupContextMenus);

function setupContextMenus() {
  chrome.contextMenus.removeAll(() => {
    // 1. Download Video (Link / Media)
    chrome.contextMenus.create({
      id: "zak-dl-video",
      title: "⚡ Download Video (Auto-HD) with ZDownloader",
      contexts: ["link", "video", "audio"]
    });

    // 2. Download MP3 Audio
    chrome.contextMenus.create({
      id: "zak-dl-audio",
      title: "🎧 Download MP3 Audio with ZDownloader",
      contexts: ["link", "video", "audio"]
    });

    // 3. Download from Current Page
    chrome.contextMenus.create({
      id: "zak-dl-page",
      title: "⚡ Download Video from this Page",
      contexts: ["page"]
    });

    // 4. Open Side Panel
    if (chrome.sidePanel) {
      chrome.contextMenus.create({
        id: "zak-open-sidepanel",
        title: "📑 Open ZDownloader Side Panel",
        contexts: ["all"]
      });
    }

    // 5. Sync Browser Session Cookies
    chrome.contextMenus.create({
      id: "zak-sync-cookies",
      title: "🍪 Sync Session Cookies with Backend",
      contexts: ["all"]
    });
  });
}

// ── Dynamic Video Sniffer Badge ────────────────────────────────
function isSupportedVideoUrl(url) {
  if (!url || typeof url !== "string") return false;
  if (url.startsWith("chrome://") || url.startsWith("edge://") || url.startsWith("about:") || url.startsWith("chrome-extension://")) return false;
  if (/(youtu\.be|youtube\.com\/(watch|shorts|embed))/i.test(url)) return true;
  if (/tiktok\.com\//i.test(url)) return true;
  if (/instagram\.com\/(reel|reels|p|tv|share)?/i.test(url)) return true;
  if (/snapchat\.com\/(spotlight|add)/i.test(url)) return true;
  if (/(twitter\.com|x\.com)\/[^/]+\/status\/\d+/i.test(url)) return true;
  if (/(facebook\.com|fb\.watch)/i.test(url)) return true;
  if (/(pinterest\.com\/pin|pin\.it)/i.test(url)) return true;
  if (/reddit\.com\/r\/[^\/]+\/comments\//i.test(url)) return true;
  return false;
}

function updateTabBadge(tabId, url) {
  if (!tabId) return;
  // If download in progress, do not overwrite download status badge
  if (activeDownload && !["done", "error", null].includes(activeDownload?.status)) return;

  if (isSupportedVideoUrl(url)) {
    chrome.action.setBadgeText({ tabId: tabId, text: "🎬" }).catch(() => {});
    chrome.action.setBadgeBackgroundColor({ tabId: tabId, color: "#00d4ff" }).catch(() => {});
    chrome.action.setTitle({ tabId: tabId, title: "ZDownloader PRO • Video Detected! Tap to Download or Send to Mobile" }).catch(() => {});
  } else {
    chrome.action.setBadgeText({ tabId: tabId, text: "" }).catch(() => {});
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === "complete") {
    updateTabBadge(tabId, tab.url);
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab && tab.url) {
      updateTabBadge(activeInfo.tabId, tab.url);
    }
  } catch {}
});

async function resolveContextUrl(info, tab) {
  // 1. Ask active tab's content script which element was clicked
  if (tab && tab.id) {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { action: "GET_CONTEXT_URL" });
      if (response && response.url && isValidDownloadUrl(response.url)) {
        return response.url;
      }
    } catch (e) {
      // Content script might not be injected or ready
    }
  }

  // 2. Check info.linkUrl
  if (info.linkUrl && isValidDownloadUrl(info.linkUrl)) {
    return info.linkUrl;
  }

  // 3. Fallback to tab.url
  if (tab && tab.url && isValidDownloadUrl(tab.url)) {
    return tab.url;
  }

  return null;
}

function isValidDownloadUrl(url) {
  if (!url || typeof url !== "string") return false;
  if (url.startsWith("blob:") || url.startsWith("chrome://") || url.startsWith("edge://")) return false;
  if (!url.startsWith("http://") && !url.startsWith("https://")) return false;
  // Ignore static images / cdn fragments
  if (url.includes("v1.pinimg.com") || url.includes("i.pinimg.com/236x") || url.includes("fbcdn.net")) return false;
  return true;
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "zak-open-sidepanel") {
    if (chrome.sidePanel && tab && tab.windowId) {
      chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
    }
    return;
  }

  if (info.menuItemId === "zak-sync-cookies") {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "ZDownloader Cookie Sync",
      message: "Syncing cookies with backend..."
    });
    const res = await syncAllCookies();
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "ZDownloader Cookie Sync",
      message: res.ok ? `✅ ${res.message}` : `⚠️ ${res.message}`
    });
    return;
  }

  const isAudio = info.menuItemId === "zak-dl-audio";
  const targetUrl = await resolveContextUrl(info, tab);

  if (!targetUrl) {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "ZDownloader • By Basit",
      message: "⚠️ Video link detect nahi ho saka. Video ko click karke open karein aur dobara try karein."
    });
    return;
  }

  const title = tab ? tab.title : (isAudio ? "Audio Download" : "Video Download");

  // Quick notification that download was triggered
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "ZDownloader • By Basit",
    message: `⚡ Started: ${isAudio ? "MP3 Audio" : "Video"} is downloading in background...`
  });

  const thumb = getThumbnailForUrl(targetUrl);
  try {
    await startDownload(targetUrl, "best", isAudio, title, null, null, thumb);
  } catch (err) {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "ZDownloader Error",
      message: err.message || "Download could not be started."
    });
  }
});

// Keyboard shortcut: Alt+D → open popup (defined in manifest)
chrome.commands.onCommand.addListener(async (command) => {
  if (command === "quick-download") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && isValidDownloadUrl(tab.url)) {
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "ZDownloader • By Basit",
        message: "⚡ Quick download starting..."
      });
      const thumb = getThumbnailForUrl(tab.url);
      try {
        await startDownload(tab.url, "best", false, tab.title || "Video", null, null, thumb);
      } catch (err) {
        chrome.notifications.create({
          type: "basic",
          iconUrl: "icons/icon128.png",
          title: "ZDownloader Error",
          message: err.message || "Download could not be started."
        });
      }
    }
  }
});

// ── Standalone Direct Engine Map ──────────────────────────────
const standaloneDownloads = new Map();

function broadcastProgress(data) {
  chrome.runtime.sendMessage({
    action: "PROGRESS_TICK",
    data: { ...data, queueLength: downloadQueue.length }
  }).catch(() => {});

  chrome.tabs.query({}, tabs => {
    tabs.forEach(tab => {
      if (tab.id && tab.url && !tab.url.startsWith("chrome://") && !tab.url.startsWith("edge://")) {
        chrome.tabs.sendMessage(tab.id, {
          action: "PROGRESS_TICK",
          data: { ...data, queueLength: downloadQueue.length }
        }).catch(() => {});
      }
    });
  });
}

// Handle messages from popup & content script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "START_DOWNLOAD") {
    const item = {
      url: msg.url, quality: msg.quality, audioOnly: msg.audioOnly,
      title: msg.title, thumbnail: msg.thumbnail,
      startTime: msg.startTime, endTime: msg.endTime,
      directStream: msg.directStream,
      turbo: msg.turbo !== false
    };

    if (activeDownload && !["done","error",null].includes(activeDownload?.status)) {
      // Queue it
      downloadQueue.push(item);
      chrome.runtime.sendMessage({ action: "QUEUE_UPDATE", queue: downloadQueue }).catch(() => {});
      sendResponse({ ok: true, queued: true, position: downloadQueue.length });
      return false;
    }

    // If directStream specified or server is offline, use standalone engine
    if (item.directStream) {
      startStandaloneDownload(item)
        .then(res => sendResponse(res))
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;
    }

    // Try Turbo python server first, fallback to standalone
    startDownload(item.url, item.quality, item.audioOnly, item.title, item.startTime, item.endTime, item.thumbnail, item.turbo)
      .then(res => sendResponse(res))
      .catch(err => {
        // Fallback to standalone direct download
        startStandaloneDownload(item)
          .then(res => sendResponse(res))
          .catch(e => sendResponse({ ok: false, error: e.message || err.message }));
      });
    return true;
  }

  if (msg.action === "GET_QUEUE") {
    sendResponse({ queue: downloadQueue });
    return false;
  }

  if (msg.action === "CHECK_STATUS") {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1600);
    fetch(`${API_BASE}/api/status`, { signal: ctrl.signal })
      .then(res => res.json())
      .then(data => {
        clearTimeout(t);
        sendResponse({ ok: true, online: true, mode: "turbo", data });
      })
      .catch(() => {
        clearTimeout(t);
        sendResponse({ ok: true, online: false, mode: "standalone" });
      });
    return true;
  }

  if (msg.action === "GET_INFO") {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2000);
    fetch(`${API_BASE}/api/info`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: msg.url }),
      signal: ctrl.signal
    })
      .then(async res => {
        clearTimeout(t);
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Info fetch failed");
        sendResponse({ ok: true, data: { ...data, engine: "turbo" } });
      })
      .catch(async () => {
        clearTimeout(t);
        // Standalone Direct Extractor (zero Python required)
        try {
          const saInfo = await getStandaloneVideoInfo(msg.url);
          sendResponse(saInfo);
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
      });
    return true;
  }

  if (msg.action === "BATCH_ENQUEUE") {
    const items = msg.items || [];
    let count = 0;
    items.forEach(it => {
      const item = {
        url: it.url,
        quality: it.quality || "best",
        audioOnly: !!it.audioOnly,
        title: it.title || "Video",
        thumbnail: it.thumbnail || "",
        directStream: it.directStream || "",
        turbo: it.turbo !== false
      };
      if (!activeDownload || ["done","error",null].includes(activeDownload?.status)) {
        if (item.directStream) {
          startStandaloneDownload(item).catch(() => {});
        } else {
          startDownload(item.url, item.quality, item.audioOnly, item.title, null, null, item.thumbnail, item.turbo)
            .catch(() => startStandaloneDownload(item).catch(() => {}));
        }
      } else {
        downloadQueue.push(item);
      }
      count++;
    });
    chrome.runtime.sendMessage({ action: "QUEUE_UPDATE", queue: downloadQueue }).catch(() => {});
    sendResponse({ ok: true, queued: count });
    return false;
  }

  if (msg.action === "DOWNLOAD_URL") {
    try {
      chrome.downloads.download({
        url: msg.url,
        filename: msg.filename || "ZDownloader/download",
        saveAs: false
      }, dlId => {
        if (chrome.runtime.lastError) sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        else sendResponse({ ok: true, id: dlId });
      });
    } catch (e) {
      sendResponse({ ok: false, error: e.message });
    }
    return true;
  }

  if (msg.action === "GET_ACTIVE_DOWNLOAD") {
    sendResponse({ activeDownload });
    return false;
  }

  if (msg.action === "CLEAR_ACTIVE_DOWNLOAD") {
    activeDownload = null;
    chrome.action.setBadgeText({ text: "" });
    sendResponse({ ok: true });
    return false;
  }

  if (msg.action === "SYNC_COOKIES") {
    syncAllCookies()
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.action === "CANCEL_DOWNLOAD") {
    const jId = activeDownload ? (activeDownload.jobId || activeDownload.job_id) : null;
    if (jId) {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      fetch(`${API_BASE}/api/cancel/${jId}`, { method: "POST" })
        .then(r => r.json())
        .then(data => {
          activeDownload = null;
          chrome.action.setBadgeText({ text: "" });
          sendResponse({ ok: true, data });
        })
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;
    }
// ── Standalone Direct Downloader (Zero Python Required) ───────────
async function startStandaloneDownload(item) {
  let streamUrl = item.directStream;
  let title = item.title || "Video";
  let thumb = item.thumbnail || "";

  if (!streamUrl) {
    const info = await getStandaloneVideoInfo(item.url);
    if (info && info.ok && info.data) {
      streamUrl = info.data.directStream || (info.data.qualities && info.data.qualities[0] ? info.data.qualities[0].url : null);
      if (info.data.title) title = info.data.title;
      if (info.data.thumbnail) thumb = info.data.thumbnail;
    }
  }

  if (!streamUrl) {
    if (/\.(mp4|webm|mkv|mov|mp3|m4a)(\?.*)?$/i.test(item.url)) {
      streamUrl = item.url;
    } else {
      throw new Error("Could not find direct video stream. Make sure the video is public.");
    }
  }

  const ext = item.audioOnly ? "mp3" : "mp4";
  const cleanTitle = sanitizeFilename(title);
  const targetFilename = `ZDownloader/${cleanTitle}.${ext}`;

  activeDownload = {
    jobId: "sa_" + Date.now(),
    url: item.url,
    title: title,
    thumbnail: thumb || getThumbnailForUrl(item.url),
    quality: item.quality || "best",
    audioOnly: !!item.audioOnly,
    status: "downloading",
    progress: 5,
    speed: "Direct",
    eta: "Direct Chrome Download",
    startTime: Date.now()
  };
  broadcastProgress(activeDownload);
  chrome.action.setBadgeText({ text: "0%" });
  chrome.action.setBadgeBackgroundColor({ color: "#00d4ff" });

  return new Promise((resolve, reject) => {
    chrome.downloads.download({
      url: streamUrl,
      filename: targetFilename,
      saveAs: false,
      conflictAction: "uniquify"
    }, dlId => {
      if (chrome.runtime.lastError || !dlId) {
        chrome.action.setBadgeText({ text: "ERR" });
        chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });
        activeDownload = null;
        reject(new Error(chrome.runtime.lastError ? chrome.runtime.lastError.message : "Download rejected"));
      } else {
        standaloneDownloads.set(dlId, { ...activeDownload, dlId });
        monitorStandaloneDownload(dlId, activeDownload);
        resolve({ ok: true, jobId: activeDownload.jobId, downloadId: dlId });
      }
    });
  });
}

function monitorStandaloneDownload(dlId, meta) {
  const poll = setInterval(() => {
    chrome.downloads.search({ id: dlId }, res => {
      if (!res || res.length === 0) {
        clearInterval(poll);
        return;
      }
      const item = res[0];
      if (item.state === "complete") {
        clearInterval(poll);
        standaloneDownloads.delete(dlId);
        activeDownload = {
          ...meta,
          status: "done",
          progress: 100,
          speed: "Direct",
          eta: "Complete",
          filename: item.filename ? item.filename.split(/[\/\\]/).pop() : (meta.title + ".mp4")
        };
        broadcastProgress(activeDownload);
        chrome.action.setBadgeText({ text: "✓" });
        chrome.action.setBadgeBackgroundColor({ color: "#10b981" });

        const notifId = "zdl-done-" + Date.now();
        _lastDoneNotifId = notifId;
        chrome.notifications.create(notifId, {
          type: "basic",
          iconUrl: "icons/icon128.png",
          title: "✅ ZDownloader PRO — Complete!",
          message: activeDownload.filename || meta.title || "Video saved",
          priority: 2
        });

        startNextInQueue();
      } else if (item.state === "interrupted") {
        clearInterval(poll);
        standaloneDownloads.delete(dlId);
        activeDownload = {
          ...meta,
          status: "error",
          error: item.error || "Download interrupted"
        };
        broadcastProgress(activeDownload);
        chrome.action.setBadgeText({ text: "ERR" });
        chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });
      } else if (item.state === "in_progress") {
        const received = item.bytesReceived || 0;
        const total = item.totalBytes > 0 ? item.totalBytes : 0;
        const pct = total > 0 ? Math.min(99, Math.round((received / total) * 100)) : 50;
        const mbRec = (received / 1048576).toFixed(1);
        const mbTot = total > 0 ? (total / 1048576).toFixed(1) : "?";

        activeDownload = {
          ...meta,
          status: "downloading",
          progress: pct,
          speed: `${mbRec}MB / ${mbTot}MB`,
          eta: total > 0 ? `${pct}%` : "Streaming"
        };
        broadcastProgress(activeDownload);
        chrome.action.setBadgeText({ text: `${pct}%` });
        chrome.action.setBadgeBackgroundColor({ color: "#00d4ff" });
      }
    });
  }, 450);
}

// ── Standalone Direct Stream Extractor ────────────────────────────
async function getStandaloneVideoInfo(url) {
  if (!url) return { ok: false, error: "Empty URL" };

  // 1. Direct media file
  if (/\.(mp4|webm|mkv|mov|mp3|m4a)(\?.*)?$/i.test(url)) {
    const filename = url.split("/").pop().split("?")[0] || "Direct Video";
    return {
      ok: true,
      data: {
        title: decodeURIComponent(filename),
        thumbnail: "",
        duration: 0,
        platform: "Direct Media",
        engine: "standalone",
        directStream: url,
        qualities: [
          { height: 1080, label: "Direct Stream (Original)", size: "Direct Link", url: url }
        ]
      }
    };
  }

  // 2. Facebook
  if (/facebook\.com|fb\.watch/i.test(url)) {
    try {
      const res = await fetch(`https://api.siputzx.my.id/api/d/facebook?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(6000) });
      const json = await res.json();
      if (json.status && json.data) {
        const hd = json.data.urls?.find(u => u.hd)?.hd;
        const sd = json.data.urls?.find(u => u.sd)?.sd;
        const stream = hd || sd || json.data.urls?.[0]?.sd || json.data.urls?.[0]?.hd;
        if (stream) {
          const qualities = [];
          if (hd) qualities.push({ height: 1080, label: "HD Video (SnapCDN)", size: "Direct MP4", url: hd });
          if (sd) qualities.push({ height: 720, label: "SD Video", size: "Direct MP4", url: sd });
          if (qualities.length === 0) qualities.push({ height: 720, label: "Standard Video", size: "Direct MP4", url: stream });
          return {
            ok: true,
            data: {
              title: json.data.title || "Facebook Video",
              thumbnail: json.data.thumbnail || "https://static.xx.fbcdn.net/rsrc.php/yD/r/d4ZIVX-5C-b.ico",
              duration: 0,
              platform: "Facebook",
              engine: "standalone",
              directStream: stream,
              qualities: qualities
            }
          };
        }
      }
    } catch (e) {
      console.warn("FB standalone parse error:", e);
    }
  }

  // 3. TikTok
  if (/tiktok\.com/i.test(url)) {
    try {
      const res = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(6000) });
      const json = await res.json();
      if (json.code === 0 && json.data) {
        const stream = json.data.play || json.data.wmplay;
        return {
          ok: true,
          data: {
            title: json.data.title || "TikTok Video",
            thumbnail: json.data.cover || "",
            duration: json.data.duration || 0,
            platform: "TikTok",
            engine: "standalone",
            directStream: stream,
            qualities: [
              { height: 1080, label: "HD (No Watermark)", size: "Direct MP4", url: stream },
              { height: 720, label: "Watermark Version", size: "Direct MP4", url: json.data.wmplay || stream }
            ]
          }
        };
      }
    } catch (e) {
      console.warn("TikTok standalone parse error:", e);
    }
  }

  // 4. Instagram
  if (/instagram\.com/i.test(url)) {
    try {
      const res = await fetch(`https://api.siputzx.my.id/api/d/ig?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(6000) });
      const json = await res.json();
      if (json.status && json.data && json.data.length > 0) {
        const item = json.data[0];
        const stream = item.url;
        if (stream) {
          return {
            ok: true,
            data: {
              title: "Instagram Reel / Video",
              thumbnail: item.thumbnail || "",
              duration: 0,
              platform: "Instagram",
              engine: "standalone",
              directStream: stream,
              qualities: [
                { height: 1080, label: "HD Quality", size: "Direct MP4", url: stream }
              ]
            }
          };
        }
      }
    } catch (e) {
      console.warn("IG standalone parse error:", e);
    }
  }

  // 5. Generic Web Video (Open Graph / Scrape with all_urls privileges)
  try {
    const pageHtml = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(5000)
    }).then(r => r.text());

    const ogVideoMatch = pageHtml.match(/<meta\s+property=["']og:video(?::secure_url|:url)?["']\s+content=["']([^"']+)["']/i) ||
                         pageHtml.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:video(?::secure_url|:url)?["']/i);
    const ogTitleMatch = pageHtml.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i) ||
                         pageHtml.match(/<title>([^<]+)<\/title>/i);
    const ogImageMatch = pageHtml.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);

    if (ogVideoMatch && ogVideoMatch[1]) {
      const stream = ogVideoMatch[1].replace(/&amp;/g, '&');
      return {
        ok: true,
        data: {
          title: ogTitleMatch ? ogTitleMatch[1].trim() : "Web Video",
          thumbnail: ogImageMatch ? ogImageMatch[1] : "",
          duration: 0,
          platform: "Web Video",
          engine: "standalone",
          directStream: stream,
          qualities: [
            { height: 1080, label: "HD Stream", size: "MP4 Video", url: stream }
          ]
        }
      };
    }
  } catch (e) {}

  // 6. YouTube or generic fallback
  const isYt = /youtu(\.be|be\.com)/i.test(url);
  return {
    ok: true,
    data: {
      title: isYt ? "YouTube Video" : "Online Video",
      thumbnail: getThumbnailForUrl(url),
      duration: 0,
      platform: isYt ? "YouTube" : "Video",
      engine: "standalone",
      qualities: [
        { height: 1080, label: "Auto-HD Quality", size: "MP4 Video", url: url },
        { height: 720, label: "720p HD", size: "MP4 Video", url: url }
      ]
    }
  };
}

// ✅ FIX: thumbnail and turbo parameters in function signature
async function startDownload(url, quality = "best", audioOnly = false, title = "Video", startTime = null, endTime = null, thumbnail = "", turbo = true) {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  // Update badge to starting state
  chrome.action.setBadgeText({ text: "..." });
  chrome.action.setBadgeBackgroundColor({ color: "#6366f1" });

  try {
    const payload = { url, quality, audio_only: audioOnly, turbo: turbo !== false };
    if (startTime) payload.start_time = startTime;
    if (endTime) payload.end_time = endTime;

    const res = await fetch(`${API_BASE}/api/download`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Download start failed");

    activeDownload = {
      jobId: data.job_id,
      url,
      title,
      thumbnail: thumbnail || getThumbnailForUrl(url), // ✅ FIX: thumbnail now accessible
      quality,
      audioOnly,
      status: "starting",
      progress: 0,
      speed: "",
      eta: "",
      startTime: Date.now()
    };

    pollTimer = setInterval(() => pollJob(data.job_id), 650);
    return { ok: true, jobId: data.job_id };
  } catch (err) {
    chrome.action.setBadgeText({ text: "ERR" });
    chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });
    setTimeout(() => chrome.action.setBadgeText({ text: "" }), 3000);
    throw err;
  }
}

function getThumbnailForUrl(url) {
  if (!url) return "";
  const ytMatch = url.match(/(?:youtu\.be\/|watch\?v=|\/shorts\/)([a-zA-Z0-9_-]{11})/);
  if (ytMatch && ytMatch[1]) {
    return `https://i.ytimg.com/vi/${ytMatch[1]}/hqdefault.jpg`;
  }
  return "";
}

async function pollJob(jobId) {
  try {
    const res = await fetch(`${API_BASE}/api/progress/${jobId}`);
    if (!res.ok) return;
    const job = await res.json();

    if (!activeDownload || activeDownload.jobId !== jobId) return;

    activeDownload.status = job.status;
    activeDownload.progress = job.progress || 0;
    activeDownload.speed = job.speed || "";
    activeDownload.eta = job.eta || "";
    if (job.title && (!activeDownload.title || activeDownload.title === "Video" || activeDownload.title === "Audio Download")) {
      activeDownload.title = job.title;
    }
    if (job.thumbnail) {
      activeDownload.thumbnail = job.thumbnail;
    }
    if (job.filename) activeDownload.filename = job.filename;

    // Broadcast to popup if open
    chrome.runtime.sendMessage({
      action: "PROGRESS_TICK",
      data: { ...activeDownload, queueLength: downloadQueue.length }
    }).catch(() => {});

    // Broadcast to all content scripts (for FAB update)
    chrome.tabs.query({}, tabs => {
      tabs.forEach(tab => {
        if (tab.id && tab.url && !tab.url.startsWith("chrome://") && !tab.url.startsWith("edge://")) {
          chrome.tabs.sendMessage(tab.id, {
            action: "PROGRESS_TICK",
            data: { ...activeDownload, queueLength: downloadQueue.length }
          }).catch(() => {});
        }
      });
    });

    // Update Extension Badge on Chrome Toolbar
    if (job.status === "downloading") {
      const pct = Math.round(job.progress || 0);
      chrome.action.setBadgeText({ text: `${pct}%` });
      chrome.action.setBadgeBackgroundColor({ color: "#6366f1" });
    } else if (job.status === "processing") {
      chrome.action.setBadgeText({ text: "PROC" });
      chrome.action.setBadgeBackgroundColor({ color: "#f59e0b" });
    } else if (job.status === "done") {
      clearInterval(pollTimer);
      pollTimer = null;

      chrome.action.setBadgeText({ text: "✓" });
      chrome.action.setBadgeBackgroundColor({ color: "#10b981" });

      // Trigger Chrome Native Download Manager with safe filename
      try {
        const safeName = job.filename ? sanitizeFilename(job.filename) : undefined;
        chrome.downloads.download({
          url: `${API_BASE}/api/file/${jobId}`,
          filename: safeName,
          conflictAction: "uniquify"
        }, downloadId => {
          if (chrome.runtime.lastError) {
            // Fallback download without custom filename
            chrome.downloads.download({
              url: `${API_BASE}/api/file/${jobId}`,
              conflictAction: "uniquify"
            });
          }
        });
      } catch (dlErr) {
        chrome.downloads.download({
          url: `${API_BASE}/api/file/${jobId}`,
          conflictAction: "uniquify"
        });
      }

      // System notification with action button
      const notifId = "zdl-done-" + Date.now();
      _lastDoneNotifId = notifId; // BUG FIX: store at top level for listener
      chrome.notifications.create(notifId, {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "✅ ZDownloader — Complete!",
        message: activeDownload.title || "Video",
        contextMessage: "Click to open downloads folder",
        buttons: [{ title: "📁 Open Folder" }]
      });

      // NOTE: onButtonClicked is handled by the top-level listener above.

      // Start next in queue
      startNextInQueue();

      setTimeout(() => {
        chrome.action.setBadgeText({ text: "" });
      }, 5000);
    } else if (job.status === "error") {
      clearInterval(pollTimer);
      pollTimer = null;

      chrome.action.setBadgeText({ text: "ERR" });
      chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });

      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "ZDownloader Error",
        message: job.error || "Download could not be completed."
      });

      // BUG FIX: start next queued item even after error
      startNextInQueue();

      setTimeout(() => {
        chrome.action.setBadgeText({ text: "" });
      }, 4000);
    }
  } catch (err) {
    // Network retry silent
  }
}

function sanitizeFilename(name) {
  if (!name) return "video.mp4";
  // Remove emojis and non-standard characters that Chrome download API rejects
  let clean = name.replace(/[^\x20-\x7E]/g, " ").replace(/[\\/*?:"<>|]/g, "_").replace(/\s+/g, " ").trim();
  if (!clean || clean === ".mp4" || clean === ".mp3") clean = "video" + (name.slice(name.lastIndexOf(".")) || ".mp4");
  return clean;
}

// ── 1-Click Cookie Sync Helper ──────────────────────────────────
async function syncAllCookies() {
  const domains = [
    { name: "YouTube", domain: "youtube.com" },
    { name: "Instagram", domain: "instagram.com" },
    { name: "Facebook", domain: "facebook.com" },
    { name: "TikTok", domain: "tiktok.com" },
    { name: "Twitter / X", domain: "twitter.com" },
    { name: "Pinterest", domain: "pinterest.com" }
  ];

  const results = [];
  for (const item of domains) {
    try {
      const cookies = await chrome.cookies.getAll({ domain: item.domain });
      if (cookies && cookies.length > 0) {
        const res = await fetch(`${API_BASE}/api/sync-cookies`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            domain: item.domain,
            cookies: cookies.map(c => ({
              domain: c.domain,
              path: c.path,
              secure: c.secure,
              expirationDate: c.expirationDate,
              name: c.name,
              value: c.value
            }))
          })
        });
        if (res.ok) {
          results.push(`${item.name} (${cookies.length})`);
        }
      }
    } catch (e) {
      console.warn(`Cookie sync failed for ${item.domain}:`, e);
    }
  }

  if (results.length === 0) {
    return { ok: false, message: "Koi active cookies nahi mile. Pehle browser mein website par login karein." };
  }
  return { ok: true, message: `Synced: ${results.join(", ")}` };
}
