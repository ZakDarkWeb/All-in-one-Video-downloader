const API_BASE = "http://127.0.0.1:8000";

let activeDownload = null;
let pollTimer = null;

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
  });
}

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
  const isAudio = info.menuItemId === "zak-dl-audio";
  const targetUrl = await resolveContextUrl(info, tab);

  if (!targetUrl) {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "ZDownloader (Zak)",
      message: "⚠️ Video link detect nahi ho saka. Video ko click karke open karein aur dobara try karein."
    });
    return;
  }

  const title = tab ? tab.title : (isAudio ? "Audio Download" : "Video Download");

  // Quick notification that download was triggered
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "ZDownloader (Zak)",
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
        title: "ZDownloader (Zak)",
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

// Handle messages from popup & content script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "START_DOWNLOAD") {
    const item = {
      url: msg.url, quality: msg.quality, audioOnly: msg.audioOnly,
      title: msg.title, thumbnail: msg.thumbnail,
      startTime: msg.startTime, endTime: msg.endTime
    };
    if (activeDownload && !["done","error",null].includes(activeDownload?.status)) {
      // Queue it
      downloadQueue.push(item);
      chrome.runtime.sendMessage({ action: "QUEUE_UPDATE", queue: downloadQueue }).catch(() => {});
      sendResponse({ ok: true, queued: true, position: downloadQueue.length });
    } else {
      startDownload(item.url, item.quality, item.audioOnly, item.title, item.startTime, item.endTime, item.thumbnail)
        .then(res => sendResponse(res))
        .catch(err => sendResponse({ ok: false, error: err.message }));
    }
    return true;
  }

  if (msg.action === "GET_QUEUE") {
    sendResponse({ queue: downloadQueue });
    return false;
  }

  if (msg.action === "CHECK_STATUS") {
    fetch(`${API_BASE}/api/status`)
      .then(res => res.json())
      .then(data => sendResponse({ ok: true, data }))
      .catch(() => {
        fetch("http://localhost:8000/api/status")
          .then(res => res.json())
          .then(data => sendResponse({ ok: true, data }))
          .catch(e => sendResponse({ ok: false, error: e.message }));
      });
    return true;
  }

  if (msg.action === "GET_INFO") {
    fetch(`${API_BASE}/api/info`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: msg.url })
    })
      .then(async res => {
        const data = await res.json();
        if (!res.ok) sendResponse({ ok: false, error: data.detail || "Info fetch failed" });
        else sendResponse({ ok: true, data });
      })
      .catch(err => sendResponse({ ok: false, error: err.message }));
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
        turbo: !!it.turbo
      };
      if (!activeDownload || ["done","error",null].includes(activeDownload?.status)) {
        startDownload(item.url, item.quality, item.audioOnly, item.title, null, null, item.thumbnail, item.turbo);
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
});

// ✅ FIX: thumbnail and turbo parameters in function signature
async function startDownload(url, quality = "best", audioOnly = false, title = "Video", startTime = null, endTime = null, thumbnail = "", turbo = false) {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  // Update badge to starting state
  chrome.action.setBadgeText({ text: "..." });
  chrome.action.setBadgeBackgroundColor({ color: "#6366f1" });

  try {
    const payload = { url, quality, audio_only: audioOnly, turbo: !!turbo };
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
      chrome.notifications.create(notifId, {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "✅ ZDownloader — Complete!",
        message: activeDownload.title || "Video",
        contextMessage: "Click to open downloads folder",
        buttons: [{ title: "📁 Open Folder" }]
      });

      // Handle notification click → open folder
      chrome.notifications.onButtonClicked.addListener((nId, btnIdx) => {
        if (nId === notifId && btnIdx === 0) {
          fetch(`${API_BASE}/api/open-downloads`, { method: "POST" }).catch(() => {});
        }
      });

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
