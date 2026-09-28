package com.basit.zdownloader;

import android.Manifest;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.net.URLEncoder;
import java.text.DecimalFormat;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

public class MainActivity extends AppCompatActivity {

    private FrameLayout rootFrameLayout;
    private WebView webView;
    private WebView snifferWebView = null;
    private String pendingSharedUrl = null;
    private String lastAutoPastedUrl = "";
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private Runnable snifferTimeoutRunnable = null;

    // ── Native In-App Mini Browser Components ──
    private LinearLayout miniBrowserLayout;
    private WebView miniBrowserWebView;
    private EditText browserUrlInput;
    private ProgressBar browserProgressBar;
    private Button btnBrowserSniffer;
    private final List<String> detectedMediaUrls = new CopyOnWriteArrayList<>();
    private String lastMiniBrowserHost = "";
    private Runnable autoDownloadRunnable = null;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        rootFrameLayout = new FrameLayout(this);
        rootFrameLayout.setLayoutParams(new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        webView = new WebView(this);
        webView.setLayoutParams(new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        rootFrameLayout.addView(webView);

        setupWebView();
        setupMiniBrowser();
        rootFrameLayout.addView(miniBrowserLayout);

        setContentView(rootFrameLayout);

        checkRuntimePermissions();
        handleIntent(getIntent());
        registerDownloadCompleteReceiver();

        // Load local bundled web app from assets
        webView.loadUrl("file:///android_asset/index.html");
    }

    private void checkRuntimePermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 101);
            }
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && Build.VERSION_CODES.Q > Build.VERSION_CODES.M) {
            if (checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE, Manifest.permission.READ_EXTERNAL_STORAGE}, 102);
            }
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        checkAndAutoPasteClipboard();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    private void handleIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        String type = intent.getType();

        if (Intent.ACTION_SEND.equals(action) && type != null && "text/plain".equals(type)) {
            String sharedText = intent.getStringExtra(Intent.EXTRA_TEXT);
            if (sharedText != null) {
                Matcher matcher = Pattern.compile("https?://[^\\s\"'>]+").matcher(sharedText);
                if (matcher.find()) {
                    pendingSharedUrl = matcher.group(0);
                    injectPendingUrl();
                }
            }
        }
    }

    private void checkAndAutoPasteClipboard() {
        try {
            ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            if (clipboard != null && clipboard.hasPrimaryClip() && clipboard.getPrimaryClip().getItemCount() > 0) {
                ClipData.Item item = clipboard.getPrimaryClip().getItemAt(0);
                CharSequence text = item.getText();
                if (text != null) {
                    String str = text.toString().trim();
                    Matcher matcher = Pattern.compile("https?://[^\\s\"'>]+").matcher(str);
                    if (matcher.find()) {
                        String foundUrl = matcher.group(0);
                        if (isSupportedUrl(foundUrl) && !foundUrl.equals(lastAutoPastedUrl)) {
                            lastAutoPastedUrl = foundUrl;
                            final String autoUrl = foundUrl;
                            mainHandler.postDelayed(() -> {
                                String js = "javascript:(function() {" +
                                        "  if (typeof onNewLinkDetected === 'function') {" +
                                        "    onNewLinkDetected('" + autoUrl.replace("'", "\\'") + "', 'clipboard');" +
                                        "  } else {" +
                                        "    var inp = document.getElementById('mUrlInput');" +
                                        "    if (inp) { inp.value = '" + autoUrl.replace("'", "\\'") + "'; }" +
                                        "    if (typeof showToast === 'function') showToast('📋 Link clipboard se auto-paste ho gaya!');" +
                                        "  }" +
                                        "  setTimeout(function() {" +
                                        "    var btn = document.getElementById('mStartDlBtn');" +
                                        "    if (btn && !btn.disabled) btn.click();" +
                                        "  }, 900);" +
                                        "})();";
                                webView.evaluateJavascript(js, null);
                            }, 500);
                        }
                    }
                }
            }
        } catch (Exception ignored) {}
    }

    private boolean isSupportedUrl(String url) {
        if (url == null) return false;
        String u = url.toLowerCase();
        return u.contains("instagram.com") || u.contains("facebook.com") || u.contains("fb.watch") ||
                u.contains("tiktok.com") || u.contains("youtube.com") || u.contains("youtu.be") ||
                u.contains("pinterest.com") || u.contains("pin.it") || u.contains("twitter.com") || u.contains("x.com");
    }

    private void injectPendingUrl() {
        if (pendingSharedUrl == null || webView == null) return;
        final String cleanUrl = pendingSharedUrl;
        pendingSharedUrl = null;
        lastAutoPastedUrl = cleanUrl;

        mainHandler.postDelayed(() -> {
            String js = "javascript:(function() {" +
                    "  if (typeof onNewLinkDetected === 'function') {" +
                    "    onNewLinkDetected('" + cleanUrl.replace("'", "\\'") + "', 'share');" +
                    "  } else {" +
                    "    var inp = document.getElementById('mUrlInput');" +
                    "    if (inp) inp.value = '" + cleanUrl.replace("'", "\\'") + "';" +
                    "  }" +
                    "  setTimeout(function() {" +
                    "    var btn = document.getElementById('mStartDlBtn');" +
                    "    if (btn && !btn.disabled) btn.click();" +
                    "  }, 900);" +
                    "})();";
            webView.evaluateJavascript(js, null);
        }, 800);
    }

    private void setupWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setSupportMultipleWindows(true);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
            CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);
        }

        // Expose Native Android JS Bridge
        webView.addJavascriptInterface(new WebAppInterface(), "Android");

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
                WebView newWebView = new WebView(MainActivity.this);
                newWebView.setWebViewClient(new WebViewClient() {
                    @Override
                    public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                        String u = req.getUrl().toString();
                        if (isMediaUrl(u)) {
                            triggerDownload(u, "ZDownloader_" + System.currentTimeMillis() + ".mp4");
                        }
                        return true;
                    }

                    @Override
                    public boolean shouldOverrideUrlLoading(WebView v, String u) {
                        if (isMediaUrl(u)) {
                            triggerDownload(u, "ZDownloader_" + System.currentTimeMillis() + ".mp4");
                        }
                        return true;
                    }
                });
                WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
                transport.setWebView(newWebView);
                resultMsg.sendToTarget();
                return true;
            }
        });

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                injectPendingUrl();
                mainHandler.postDelayed(() -> checkAndAutoPasteClipboard(), 600);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String targetUrl = request.getUrl().toString();
                return handleNavigation(targetUrl);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String targetUrl) {
                return handleNavigation(targetUrl);
            }

            private boolean handleNavigation(String targetUrl) {
                if (targetUrl == null) return false;
                if (targetUrl.startsWith("file:///android_asset/")) {
                    return false;
                }
                if (isMediaUrl(targetUrl)) {
                    triggerDownload(targetUrl, "ZDownloader_" + System.currentTimeMillis() + ".mp4");
                    return true;
                }
                // Do not hijack screen with mini browser on background link navigations
                return false;
            }
        });

        webView.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimeType, long contentLength) {
                String filename = URLUtil.guessFileName(url, contentDisposition, mimeType);
                if (!filename.toLowerCase().endsWith(".mp4") && !filename.toLowerCase().endsWith(".mp3")) {
                    filename = "ZDownloader_" + System.currentTimeMillis() + (mimeType != null && mimeType.contains("audio") ? ".mp3" : ".mp4");
                }
                triggerDownload(url, filename);
            }
        });
    }

    private boolean isMediaUrl(String url) {
        if (url == null) return false;
        String u = url.toLowerCase();
        if (u.contains(".js") || u.contains(".css") || u.contains(".html") || u.contains("login") || u.contains("auth")) return false;
        return u.endsWith(".mp4") || u.endsWith(".mp3") || u.endsWith(".mkv") || u.endsWith(".webm") ||
                u.contains(".mp4?") || u.contains(".mp3?") || u.contains(".webm?") ||
                u.contains("snapcdn") || u.contains("fbcdn.net") || u.contains("cdninstagram.com") ||
                u.contains("tiktokcdn") || u.contains("akamaized.net") || u.contains("tikwm.com") ||
                u.contains("googlevideo.com") || u.contains("mime=video") || u.contains("videoplayback") ||
                u.contains("twimg.com/video") || u.contains("v.redd.it");
    }

    public void triggerDownload(String url, String filename) {
        if (url == null || url.trim().isEmpty()) {
            Toast.makeText(MainActivity.this, "Invalid download URL", Toast.LENGTH_SHORT).show();
            return;
        }
        try {
            String cleanUrl = url.trim().replace("&amp;", "&");
            String safeFilename = (filename != null && !filename.trim().isEmpty())
                    ? filename.replaceAll("[\\\\/:*?\"<>|]", "_")
                    : ("ZDownloader_" + System.currentTimeMillis() + ".mp4");

            if (!safeFilename.toLowerCase().endsWith(".mp4") && !safeFilename.toLowerCase().endsWith(".mp3")) {
                safeFilename = safeFilename + ".mp4";
            }

            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(cleanUrl));
            String mimeType = safeFilename.endsWith(".mp3") ? "audio/mpeg" : "video/mp4";
            request.setMimeType(mimeType);
            request.addRequestHeader("User-Agent", "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36");

            try {
                String cookies = CookieManager.getInstance().getCookie(cleanUrl);
                if (cookies != null && !cookies.isEmpty()) {
                    request.addRequestHeader("Cookie", cookies);
                }
            } catch (Exception ignored) {}

            if (cleanUrl.contains("cdninstagram.com") || cleanUrl.contains("instagram.com")) {
                request.addRequestHeader("Referer", "https://www.instagram.com/");
            } else if (cleanUrl.contains("fbcdn.net") || cleanUrl.contains("facebook.com")) {
                request.addRequestHeader("Referer", "https://www.facebook.com/");
            }

            request.setTitle(safeFilename);
            request.setDescription("Downloading video via ZDownloader PRO");
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, safeFilename);

            DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            if (dm != null) {
                dm.enqueue(request);
                Toast.makeText(MainActivity.this, "⬇️ Direct Download Started: " + safeFilename, Toast.LENGTH_LONG).show();
            }

            // Notify webView of success and reset buttons
            mainHandler.post(() -> {
                String js = "if (typeof showToast === 'function') showToast('✅ Video phone ke Download folder me save ho rahi hai!');" +
                        "var st = document.getElementById('mProgStatus'); if (st) st.textContent = '✅ Download Started in Android Bar!';" +
                        "var pct = document.getElementById('mProgPct'); if (pct) pct.textContent = '100%';" +
                        "var fill = document.getElementById('mProgFill'); if (fill) fill.style.width = '100%';" +
                        "var btn = document.getElementById('mStartDlBtn'); if (btn) { btn.disabled = false; btn.innerHTML = '<span>⚡ Start Download</span>'; }";
                webView.evaluateJavascript(js, null);
            });
        } catch (Exception e) {
            e.printStackTrace();
            Toast.makeText(MainActivity.this, "Download error: " + e.getMessage(), Toast.LENGTH_LONG).show();
            mainHandler.post(() -> {
                String js = "if (typeof showToast === 'function') showToast('⚠️ Download error: " + e.getMessage().replace("'", "\\'") + "');" +
                        "var btn = document.getElementById('mStartDlBtn'); if (btn) { btn.disabled = false; btn.innerHTML = '<span>⚡ Start Download</span>'; }";
                webView.evaluateJavascript(js, null);
            });
        }
    }

    private void registerDownloadCompleteReceiver() {
        try {
            BroadcastReceiver downloadCompleteReceiver = new BroadcastReceiver() {
                @Override
                public void onReceive(Context context, Intent intent) {
                    if (DownloadManager.ACTION_DOWNLOAD_COMPLETE.equals(intent.getAction())) {
                        long downloadId = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                        if (downloadId != -1) {
                            scanCompletedDownload(downloadId);
                        }
                    }
                }
            };
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                registerReceiver(downloadCompleteReceiver, new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE), Context.RECEIVER_NOT_EXPORTED);
            } else {
                registerReceiver(downloadCompleteReceiver, new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE));
            }
        } catch (Exception ignored) {}
    }

    private void scanCompletedDownload(long downloadId) {
        try {
            DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            if (dm == null) return;
            DownloadManager.Query q = new DownloadManager.Query();
            q.setFilterById(downloadId);
            try (android.database.Cursor c = dm.query(q)) {
                if (c != null && c.moveToFirst()) {
                    int statusIdx = c.getColumnIndex(DownloadManager.COLUMN_STATUS);
                    if (statusIdx != -1 && c.getInt(statusIdx) == DownloadManager.STATUS_SUCCESSFUL) {
                        int uriIdx = c.getColumnIndex(DownloadManager.COLUMN_LOCAL_URI);
                        if (uriIdx != -1) {
                            String localUri = c.getString(uriIdx);
                            if (localUri != null) {
                                String path = Uri.parse(localUri).getPath();
                                if (path != null) {
                                    File f = new File(path);
                                    if (f.exists()) {
                                        MediaScannerConnection.scanFile(MainActivity.this, new String[]{f.getAbsolutePath()}, null, null);
                                    }
                                }
                            }
                        }
                        mainHandler.post(() -> Toast.makeText(MainActivity.this, "🎬 Video Gallery me save ho gayi!", Toast.LENGTH_SHORT).show());
                    }
                }
            }
        } catch (Exception ignored) {}
    }

    // ── Headless Background Video Stream Sniffer (Zero UI, Zero Popups) ──
    private void startBackgroundSniffer(String targetUrl) {
        if (targetUrl == null || targetUrl.trim().isEmpty()) return;
        final String cleanUrl = targetUrl.trim();

        mainHandler.post(() -> {
            destroySniffer();

            snifferWebView = new WebView(MainActivity.this);
            WebSettings s = snifferWebView.getSettings();
            s.setJavaScriptEnabled(true);
            s.setDomStorageEnabled(true);
            s.setDatabaseEnabled(true);
            s.setAllowFileAccess(true);
            s.setAllowContentAccess(true);
            s.setMediaPlaybackRequiresUserGesture(false);
            s.setJavaScriptCanOpenWindowsAutomatically(true);
            s.setUserAgentString("Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36");

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
                CookieManager.getInstance().setAcceptThirdPartyCookies(snifferWebView, true);
            }

            // Headless: 1x1 dp, completely invisible, attached so WebKit executes JS & rendering
            FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(1, 1);
            lp.gravity = Gravity.BOTTOM | Gravity.END;
            snifferWebView.setLayoutParams(lp);
            snifferWebView.setAlpha(0.01f);
            if (rootFrameLayout != null) {
                rootFrameLayout.addView(snifferWebView);
            }

            snifferWebView.addJavascriptInterface(new Object() {
                @JavascriptInterface
                public void onStreamFound(String streamUrl) {
                    if (streamUrl != null && !streamUrl.isEmpty()) {
                        mainHandler.post(() -> {
                            String ext = streamUrl.contains(".mp3") ? ".mp3" : ".mp4";
                            triggerDownload(streamUrl, "Video_" + System.currentTimeMillis() + ext);
                            destroySniffer();
                        });
                    }
                }
            }, "NativeSniffer");

            snifferWebView.setWebViewClient(new WebViewClient() {
                private boolean streamCaptured = false;

                @Override
                public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                    if (streamCaptured) return super.shouldInterceptRequest(view, request);
                    String reqUrl = request.getUrl().toString();

                    if (isSniffableVideoUrl(reqUrl)) {
                        streamCaptured = true;
                        mainHandler.post(() -> {
                            String ext = reqUrl.contains(".mp3") ? ".mp3" : ".mp4";
                            triggerDownload(reqUrl, "Video_" + System.currentTimeMillis() + ext);
                            destroySniffer();
                        });
                    }
                    return super.shouldInterceptRequest(view, request);
                }

                @Override
                public void onPageFinished(WebView view, String url) {
                    super.onPageFinished(view, url);
                    if (streamCaptured) return;

                    // Inject smart extractor to scrape video tags, meta tags, and trigger playback
                    String js = "(function() {" +
                            "  function check() {" +
                            "    var vids = document.querySelectorAll('video');" +
                            "    for (var i = 0; i < vids.length; i++) {" +
                            "      try { vids[i].muted = true; vids[i].play(); } catch(e) {}" +
                            "      var s = vids[i].currentSrc || vids[i].src;" +
                            "      if (!s) { var sc = vids[i].querySelector('source'); if (sc) s = sc.src; }" +
                            "      if (s && s.startsWith('http') && !s.startsWith('blob:')) {" +
                            "        if (window.NativeSniffer) window.NativeSniffer.onStreamFound(s);" +
                            "        return true;" +
                            "      }" +
                            "    }" +
                            "    var og = document.querySelector('meta[property=\"og:video\"]') || document.querySelector('meta[property=\"og:video:secure_url\"]');" +
                            "    if (og && og.content && og.content.startsWith('http')) {" +
                            "      if (window.NativeSniffer) window.NativeSniffer.onStreamFound(og.content);" +
                            "      return true;" +
                            "    }" +
                            "    var scripts = document.querySelectorAll('script');" +
                            "    for (var j = 0; j < scripts.length; j++) {" +
                            "      var t = scripts[j].textContent || '';" +
                            "      var m = t.match(/https:\\/\\/[^\\s\"'><\\\\]+(?:fbcdn\\.net|cdninstagram\\.com)[^\\s\"'><\\\\]*(?:\\.mp4|\\/t50\\.|bytestart)[^\\s\"'><\\\\]*/);" +
                            "      if (m && m[0]) {" +
                            "        var clean = m[0].replace(/\\\\u0026/g, '&').replace(/\\\\\\//g, '/');" +
                            "        if (window.NativeSniffer) window.NativeSniffer.onStreamFound(clean);" +
                            "        return true;" +
                            "      }" +
                            "    }" +
                            "    return false;" +
                            "  }" +
                            "  var play = document.querySelector('[aria-label=\"Play\"]') || document.querySelector('video') || document.querySelector('.EmbeddedMedia') || document.querySelector('div[role=\"button\"]');" +
                            "  if (play) { try { play.click(); } catch(e) {} }" +
                            "  if (!check()) {" +
                            "    var iv = setInterval(function() { if (check()) clearInterval(iv); }, 600);" +
                            "    setTimeout(function() { clearInterval(iv); }, 9000);" +
                            "  }" +
                            "})();";
                    view.evaluateJavascript(js, null);
                }
            });

            // 10 second timeout: destroy silently WITHOUT opening any mini browser!
            snifferTimeoutRunnable = () -> {
                if (snifferWebView != null) {
                    destroySniffer();
                    mainHandler.post(() -> {
                        String js = "if (typeof showToast === 'function') showToast('⚠️ Video automatically detect nahi ho saki. Public link check karein.');" +
                                "var card = document.getElementById('mProgCard'); if (card) card.classList.remove('show');" +
                                "var btn = document.getElementById('mStartDlBtn'); if (btn) { btn.disabled = false; btn.innerHTML = '<span>⚡ Start Download</span>'; }";
                        webView.evaluateJavascript(js, null);
                    });
                }
            };
            mainHandler.postDelayed(snifferTimeoutRunnable, 10000);

            // If Instagram link: try embed url which bypasses login barriers
            if (cleanUrl.contains("instagram.com")) {
                String shortcode = extractInstagramShortcode(cleanUrl);
                if (shortcode != null) {
                    snifferWebView.loadUrl("https://www.instagram.com/p/" + shortcode + "/embed/captioned/");
                } else {
                    snifferWebView.loadUrl(cleanUrl);
                }
            } else {
                snifferWebView.loadUrl(cleanUrl);
            }
        });
    }

    private String extractInstagramShortcode(String url) {
        if (url == null) return null;
        Matcher m = Pattern.compile("(?:reel|reels|p|tv)/([A-Za-z0-9_-]+)").matcher(url);
        if (m.find()) {
            return m.group(1);
        }
        return null;
    }

    private void destroySniffer() {
        if (snifferTimeoutRunnable != null) {
            mainHandler.removeCallbacks(snifferTimeoutRunnable);
            snifferTimeoutRunnable = null;
        }
        if (snifferWebView != null) {
            try {
                if (rootFrameLayout != null) {
                    rootFrameLayout.removeView(snifferWebView);
                }
                snifferWebView.stopLoading();
                snifferWebView.destroy();
            } catch (Exception ignored) {}
            snifferWebView = null;
        }
    }

    // ── JavaScript Interface Bridge for HTML5 Web App ──
    public class WebAppInterface {

        @JavascriptInterface
        public String getClipboardText() {
            try {
                ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                if (clipboard != null && clipboard.hasPrimaryClip() && clipboard.getPrimaryClip().getItemCount() > 0) {
                    ClipData.Item item = clipboard.getPrimaryClip().getItemAt(0);
                    CharSequence text = item.getText();
                    if (text != null) {
                        return text.toString().trim();
                    }
                }
            } catch (Exception ignored) {}
            return "";
        }

        @JavascriptInterface
        public void startNativeDownload(String url, String filename) {
            mainHandler.post(() -> triggerDownload(url, filename));
        }

        @JavascriptInterface
        public void startBackgroundSniffer(String url) {
            mainHandler.post(() -> MainActivity.this.startBackgroundSniffer(url));
        }

        @JavascriptInterface
        public void sniffAndDownloadInstagram(String igUrl) {
            mainHandler.post(() -> MainActivity.this.startBackgroundSniffer(igUrl));
        }

        @JavascriptInterface
        public void showAndroidToast(String msg) {
            mainHandler.post(() -> Toast.makeText(MainActivity.this, msg, Toast.LENGTH_SHORT).show());
        }

        @JavascriptInterface
        public String getDownloadedFilesJson() {
            JSONArray arr = new JSONArray();
            try {
                File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                if (dir != null && dir.exists() && dir.isDirectory()) {
                    File[] files = dir.listFiles((d, name) -> {
                        String n = name.toLowerCase();
                        return n.endsWith(".mp4") || n.endsWith(".mp3") || n.endsWith(".mkv") || n.endsWith(".webm");
                    });
                    if (files != null) {
                        java.util.Arrays.sort(files, (a, b) -> Long.compare(b.lastModified(), a.lastModified()));
                        int limit = Math.min(files.length, 50);
                        for (int i = 0; i < limit; i++) {
                            File f = files[i];
                            JSONObject obj = new JSONObject();
                            obj.put("name", f.getName());
                            obj.put("path", f.getAbsolutePath());
                            obj.put("size", f.length());
                            obj.put("sizeFormatted", formatFileSize(f.length()));
                            obj.put("date", f.lastModified());
                            obj.put("dateFormatted", new SimpleDateFormat("MMM dd, hh:mm a", Locale.getDefault()).format(new Date(f.lastModified())));
                            obj.put("isAudio", f.getName().toLowerCase().endsWith(".mp3"));
                            arr.put(obj);
                        }
                    }
                }
            } catch (Exception e) {
                e.printStackTrace();
            }
            return arr.toString();
        }

        @JavascriptInterface
        public void shareFile(String filename) {
            mainHandler.post(() -> {
                try {
                    File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                    File file = new File(dir, filename);
                    if (!file.exists()) {
                        Toast.makeText(MainActivity.this, "File nahi mili!", Toast.LENGTH_SHORT).show();
                        return;
                    }
                    Uri uri = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".fileprovider", file);
                    Intent shareIntent = new Intent(Intent.ACTION_SEND);
                    String mime = filename.endsWith(".mp3") ? "audio/*" : "video/*";
                    shareIntent.setType(mime);
                    shareIntent.putExtra(Intent.EXTRA_STREAM, uri);
                    shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    startActivity(Intent.createChooser(shareIntent, "Share with:"));
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "Share error: " + e.getMessage(), Toast.LENGTH_SHORT).show();
                }
            });
        }

        @JavascriptInterface
        public boolean deleteDownloadedFile(String filename) {
            try {
                File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                File file = new File(dir, filename);
                if (file.exists() && file.delete()) {
                    MediaScannerConnection.scanFile(MainActivity.this, new String[]{file.getAbsolutePath()}, null, null);
                    mainHandler.post(() -> Toast.makeText(MainActivity.this, "File deleted: " + filename, Toast.LENGTH_SHORT).show());
                    return true;
                }
            } catch (Exception ignored) {}
            return false;
        }

        @JavascriptInterface
        public void openFileInSystemPlayer(String filename) {
            mainHandler.post(() -> {
                try {
                    File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                    File file = new File(dir, filename);
                    if (!file.exists()) return;
                    Uri uri = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".fileprovider", file);
                    Intent intent = new Intent(Intent.ACTION_VIEW);
                    String mime = filename.endsWith(".mp3") ? "audio/*" : "video/*";
                    intent.setDataAndType(uri, mime);
                    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    startActivity(intent);
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "Player error: " + e.getMessage(), Toast.LENGTH_SHORT).show();
                }
            });
        }

        @JavascriptInterface
        public String getWhatsAppStatusesJson() {
            JSONArray arr = new JSONArray();
            try {
                String[] potentialPaths = {
                        Environment.getExternalStorageDirectory() + "/Android/media/com.whatsapp/WhatsApp/Media/.Statuses",
                        Environment.getExternalStorageDirectory() + "/WhatsApp/Media/.Statuses",
                        Environment.getExternalStorageDirectory() + "/Android/media/com.whatsapp.w4b/WhatsApp Business/Media/.Statuses",
                        Environment.getExternalStorageDirectory() + "/WhatsApp Business/Media/.Statuses"
                };

                for (String p : potentialPaths) {
                    File dir = new File(p);
                    if (dir.exists() && dir.isDirectory()) {
                        File[] files = dir.listFiles((d, name) -> {
                            String n = name.toLowerCase();
                            return !name.startsWith(".nomedia") && (n.endsWith(".mp4") || n.endsWith(".jpg") || n.endsWith(".jpeg") || n.endsWith(".png"));
                        });
                        if (files != null) {
                            java.util.Arrays.sort(files, (a, b) -> Long.compare(b.lastModified(), a.lastModified()));
                            for (File f : files) {
                                JSONObject obj = new JSONObject();
                                obj.put("name", f.getName());
                                obj.put("path", f.getAbsolutePath());
                                obj.put("size", f.length());
                                obj.put("sizeFormatted", formatFileSize(f.length()));
                                obj.put("isVideo", f.getName().toLowerCase().endsWith(".mp4"));
                                obj.put("date", f.lastModified());
                                arr.put(obj);
                            }
                        }
                    }
                }
            } catch (Exception e) {
                e.printStackTrace();
            }
            return arr.toString();
        }

        @JavascriptInterface
        public boolean saveWhatsAppStatus(String sourcePath) {
            try {
                File src = new File(sourcePath);
                if (!src.exists()) {
                    mainHandler.post(() -> Toast.makeText(MainActivity.this, "Status file nahi mili!", Toast.LENGTH_SHORT).show());
                    return false;
                }
                File destDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                if (!destDir.exists()) destDir.mkdirs();

                String ext = src.getName().contains(".") ? src.getName().substring(src.getName().lastIndexOf(".")) : ".mp4";
                File dest = new File(destDir, "WhatsApp_Status_" + System.currentTimeMillis() + ext);

                try (FileInputStream in = new FileInputStream(src); FileOutputStream out = new FileOutputStream(dest)) {
                    byte[] buf = new byte[8192];
                    int len;
                    while ((len = in.read(buf)) > 0) {
                        out.write(buf, 0, len);
                    }
                }

                MediaScannerConnection.scanFile(MainActivity.this, new String[]{dest.getAbsolutePath()}, null, null);
                mainHandler.post(() -> Toast.makeText(MainActivity.this, "✅ Status Gallery & Downloads me save ho gaya!", Toast.LENGTH_SHORT).show());
                return true;
            } catch (Exception e) {
                mainHandler.post(() -> Toast.makeText(MainActivity.this, "Save error: " + e.getMessage(), Toast.LENGTH_SHORT).show());
                return false;
            }
        }

        @JavascriptInterface
        public void openMiniBrowser(String url) {
            mainHandler.post(() -> showMiniBrowser(url));
        }

        @JavascriptInterface
        public void closeMiniBrowser() {
            mainHandler.post(() -> MainActivity.this.closeMiniBrowser());
        }

        @JavascriptInterface
        public void setStatusBarColor(String hexColor) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                mainHandler.post(() -> {
                    try {
                        int color = Color.parseColor(hexColor);
                        getWindow().setStatusBarColor(color);
                    } catch (Exception ignored) {}
                });
            }
        }

        private String formatFileSize(long bytes) {
            if (bytes <= 0) return "0 B";
            if (bytes < 1024) return bytes + " B";
            if (bytes < 1024 * 1024) return new DecimalFormat("#.0").format((double) bytes / 1024) + " KB";
            return new DecimalFormat("#.00").format((double) bytes / (1024 * 1024)) + " MB";
        }
    }

    // ── Native In-App Mini Browser & Smart Video Sniffer Engine ──
    private int dpToPx(int dp) {
        return (int) (dp * getResources().getDisplayMetrics().density + 0.5f);
    }

    private void setupMiniBrowser() {
        miniBrowserLayout = new LinearLayout(this);
        miniBrowserLayout.setOrientation(LinearLayout.VERTICAL);
        miniBrowserLayout.setLayoutParams(new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        miniBrowserLayout.setBackgroundColor(Color.parseColor("#070a13"));
        miniBrowserLayout.setVisibility(View.GONE);

        // Top Bar
        LinearLayout topBar = new LinearLayout(this);
        topBar.setOrientation(LinearLayout.HORIZONTAL);
        topBar.setBackgroundColor(Color.parseColor("#080c18"));
        topBar.setGravity(Gravity.CENTER_VERTICAL);
        topBar.setPadding(dpToPx(8), dpToPx(6), dpToPx(8), dpToPx(6));
        topBar.setLayoutParams(new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dpToPx(54)));

        // Close / Home Button (✕)
        TextView btnClose = new TextView(this);
        btnClose.setText("✕");
        btnClose.setTextColor(Color.parseColor("#f8fafc"));
        btnClose.setTextSize(18);
        btnClose.setTypeface(Typeface.DEFAULT_BOLD);
        btnClose.setPadding(dpToPx(10), dpToPx(6), dpToPx(10), dpToPx(6));
        btnClose.setOnClickListener(v -> closeMiniBrowser());
        topBar.addView(btnClose);

        // Back button (◀)
        TextView btnBack = new TextView(this);
        btnBack.setText("◀");
        btnBack.setTextColor(Color.parseColor("#94a3b8"));
        btnBack.setTextSize(14);
        btnBack.setPadding(dpToPx(8), dpToPx(6), dpToPx(8), dpToPx(6));
        btnBack.setOnClickListener(v -> {
            if (miniBrowserWebView != null && miniBrowserWebView.canGoBack()) {
                miniBrowserWebView.goBack();
            }
        });
        topBar.addView(btnBack);

        // Forward button (▶)
        TextView btnFwd = new TextView(this);
        btnFwd.setText("▶");
        btnFwd.setTextColor(Color.parseColor("#94a3b8"));
        btnFwd.setTextSize(14);
        btnFwd.setPadding(dpToPx(8), dpToPx(6), dpToPx(8), dpToPx(6));
        btnFwd.setOnClickListener(v -> {
            if (miniBrowserWebView != null && miniBrowserWebView.canGoForward()) {
                miniBrowserWebView.goForward();
            }
        });
        topBar.addView(btnFwd);

        // URL / Search Input
        browserUrlInput = new EditText(this);
        LinearLayout.LayoutParams urlParams = new LinearLayout.LayoutParams(0, dpToPx(38), 1.0f);
        urlParams.setMargins(dpToPx(4), 0, dpToPx(4), 0);
        browserUrlInput.setLayoutParams(urlParams);
        browserUrlInput.setTextColor(Color.WHITE);
        browserUrlInput.setHintTextColor(Color.parseColor("#64748b"));
        browserUrlInput.setHint("Search or enter web address...");
        browserUrlInput.setTextSize(12);
        browserUrlInput.setSingleLine(true);
        browserUrlInput.setImeOptions(EditorInfo.IME_ACTION_GO);
        browserUrlInput.setPadding(dpToPx(12), dpToPx(4), dpToPx(12), dpToPx(4));

        GradientDrawable inputBg = new GradientDrawable();
        inputBg.setColor(Color.parseColor("#141c2e"));
        inputBg.setCornerRadius(dpToPx(19));
        inputBg.setStroke(dpToPx(1), Color.parseColor("#2a3b5c"));
        browserUrlInput.setBackground(inputBg);

        browserUrlInput.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_GO || actionId == EditorInfo.IME_ACTION_SEARCH || actionId == EditorInfo.IME_ACTION_DONE) {
                hideKeyboard(browserUrlInput);
                String query = browserUrlInput.getText().toString().trim();
                navigateToMiniBrowserUrl(query);
                return true;
            }
            return false;
        });
        topBar.addView(browserUrlInput);

        // Refresh Button (🔄)
        TextView btnRefresh = new TextView(this);
        btnRefresh.setText("🔄");
        btnRefresh.setTextColor(Color.parseColor("#94a3b8"));
        btnRefresh.setTextSize(14);
        btnRefresh.setPadding(dpToPx(8), dpToPx(6), dpToPx(8), dpToPx(6));
        btnRefresh.setOnClickListener(v -> {
            if (miniBrowserWebView != null) miniBrowserWebView.reload();
        });
        topBar.addView(btnRefresh);

        miniBrowserLayout.addView(topBar);

        // Progress Bar (horizontal)
        browserProgressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        browserProgressBar.setLayoutParams(new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dpToPx(3)));
        browserProgressBar.setMax(100);
        browserProgressBar.setProgress(0);
        miniBrowserLayout.addView(browserProgressBar);

        // FrameLayout containing miniBrowserWebView and floating Sniffer Button
        FrameLayout browserContainer = new FrameLayout(this);
        browserContainer.setLayoutParams(new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1.0f));

        miniBrowserWebView = new WebView(this);
        miniBrowserWebView.setLayoutParams(new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setupMiniBrowserWebView();
        browserContainer.addView(miniBrowserWebView);

        // Floating Action Sniffer Button
        btnBrowserSniffer = new Button(this);
        FrameLayout.LayoutParams snifferParams = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dpToPx(46));
        snifferParams.gravity = Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL;
        snifferParams.bottomMargin = dpToPx(20);
        btnBrowserSniffer.setLayoutParams(snifferParams);
        btnBrowserSniffer.setText("⚡ 1 Video Detected • Download");
        btnBrowserSniffer.setTextColor(Color.parseColor("#070a13"));
        btnBrowserSniffer.setTextSize(13);
        btnBrowserSniffer.setTypeface(Typeface.DEFAULT_BOLD);
        btnBrowserSniffer.setPadding(dpToPx(20), dpToPx(6), dpToPx(20), dpToPx(6));

        GradientDrawable btnBg = new GradientDrawable(
                GradientDrawable.Orientation.LEFT_RIGHT,
                new int[]{Color.parseColor("#00f2fe"), Color.parseColor("#8b5cf6")}
        );
        btnBg.setCornerRadius(dpToPx(23));
        btnBrowserSniffer.setBackground(btnBg);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            btnBrowserSniffer.setElevation(dpToPx(8));
        }
        btnBrowserSniffer.setVisibility(View.GONE);
        btnBrowserSniffer.setOnClickListener(v -> {
            if (detectedMediaUrls.isEmpty()) {
                Toast.makeText(MainActivity.this, "No video stream detected yet. Play video on page!", Toast.LENGTH_SHORT).show();
                return;
            }
            if (detectedMediaUrls.size() == 1) {
                String chosen = detectedMediaUrls.get(0);
                String ext = chosen.contains(".mp3") ? ".mp3" : ".mp4";
                triggerDownload(chosen, "ZDownloader_" + System.currentTimeMillis() + ext);
            } else {
                showDetectedVideosDialog();
            }
        });
        browserContainer.addView(btnBrowserSniffer);

        miniBrowserLayout.addView(browserContainer);
    }

    private void setupMiniBrowserWebView() {
        WebSettings s = miniBrowserWebView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        s.setUserAgentString("Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36");

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
            CookieManager.getInstance().setAcceptThirdPartyCookies(miniBrowserWebView, true);
        }

        // Bridge for Injected DOM Video Sniffer
        miniBrowserWebView.addJavascriptInterface(new Object() {
            @JavascriptInterface
            public void onStreamFound(String streamUrl, String title) {
                if (streamUrl != null && !streamUrl.isEmpty()) {
                    addDetectedVideo(streamUrl);
                }
            }
        }, "NativeMiniSniffer");

        miniBrowserWebView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                super.onProgressChanged(view, newProgress);
                if (browserProgressBar != null) {
                    browserProgressBar.setProgress(newProgress);
                    browserProgressBar.setVisibility(newProgress == 100 ? View.GONE : View.VISIBLE);
                }
            }
        });

        miniBrowserWebView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                if (browserUrlInput != null && !browserUrlInput.hasFocus()) {
                    browserUrlInput.setText(url);
                }
                try {
                    String host = Uri.parse(url).getHost();
                    if (host != null && !host.equalsIgnoreCase(lastMiniBrowserHost)) {
                        lastMiniBrowserHost = host;
                        detectedMediaUrls.clear();
                        updateSnifferButton();
                    }
                } catch (Exception ignored) {}
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                String reqUrl = request.getUrl().toString();
                if (isSniffableVideoUrl(reqUrl)) {
                    addDetectedVideo(reqUrl);
                }
                return super.shouldInterceptRequest(view, request);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (browserUrlInput != null && !browserUrlInput.hasFocus()) {
                    browserUrlInput.setText(url);
                }

                // Inject DOM video & stream observer
                String js = "(function() {" +
                        "  function checkDomStreams() {" +
                        "    try {" +
                        "      var vids = document.querySelectorAll('video');" +
                        "      for (var i = 0; i < vids.length; i++) {" +
                        "        var s = vids[i].currentSrc || vids[i].src;" +
                        "        if (!s) { var sc = vids[i].querySelector('source'); if (sc) s = sc.src; }" +
                        "        if (s && s.startsWith('http') && !s.startsWith('blob:')) {" +
                        "          if (window.NativeMiniSniffer) window.NativeMiniSniffer.onStreamFound(s, document.title || 'Video');" +
                        "        }" +
                        "      }" +
                        "      var og = document.querySelector('meta[property=\"og:video\"]') || document.querySelector('meta[property=\"og:video:secure_url\"]');" +
                        "      if (og && og.content && og.content.startsWith('http')) {" +
                        "        if (window.NativeMiniSniffer) window.NativeMiniSniffer.onStreamFound(og.content, document.title || 'Video');" +
                        "      }" +
                        "    } catch(e) {}" +
                        "  }" +
                        "  checkDomStreams();" +
                        "  if (!window.__miniSniffIv) window.__miniSniffIv = setInterval(checkDomStreams, 2000);" +
                        "})();";
                view.evaluateJavascript(js, null);
            }
        });
    }

    private void hideKeyboard(View view) {
        if (view != null) {
            InputMethodManager imm = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
            if (imm != null) imm.hideSoftInputFromWindow(view.getWindowToken(), 0);
        }
    }

    private void navigateToMiniBrowserUrl(String query) {
        if (query == null || query.isEmpty()) return;
        String target = query;
        if (!target.startsWith("http://") && !target.startsWith("https://")) {
            if (target.contains(".") && !target.contains(" ")) {
                target = "https://" + target;
            } else {
                try {
                    target = "https://www.google.com/search?q=" + URLEncoder.encode(target, "UTF-8");
                } catch (Exception e) {
                    target = "https://www.google.com/search?q=" + target;
                }
            }
        }
        if (miniBrowserWebView != null) {
            miniBrowserWebView.loadUrl(target);
        }
    }

    private boolean isSniffableVideoUrl(String url) {
        if (url == null) return false;
        String u = url.toLowerCase();
        if (u.contains(".js") || u.contains(".css") || u.contains(".png") || u.contains(".jpg") ||
                u.contains(".jpeg") || u.contains(".gif") || u.contains(".webp") || u.contains(".svg") ||
                u.contains(".ico") || u.contains(".woff") || u.contains(".woff2") || u.contains(".ttf") ||
                u.contains("google-analytics") || u.contains("doubleclick") || u.contains("facebook.com/tr") ||
                u.contains("/ad/") || u.contains("pagead") || u.contains("/logging/") || u.contains("analytics")) {
            return false;
        }
        if (u.contains(".mp4") || u.contains(".m3u8") || u.contains(".webm") || u.contains(".mpd") || u.contains(".m4v") || u.contains(".mkv")) {
            return true;
        }
        if (u.contains("mime=video") || u.contains("video_dashinit") || u.contains("/videoplayback")) {
            return true;
        }
        if (u.contains("cdninstagram.com")) {
            return true;
        }
        if (u.contains("fbcdn.net")) {
            if (u.contains("/v/") || u.contains("video") || u.contains(".mp4") || u.contains("bytestart") ||
                    u.contains("oe=") || u.contains("t16.") || u.contains("t50.") || u.contains("t51.") ||
                    u.contains("t66.") || u.contains("/o1/")) {
                return true;
            }
        }
        if (u.contains("v.redd.it") || u.contains("tiktokcdn.com") || u.contains("tikwm.com") ||
                u.contains("twimg.com/video") || u.contains("video.twimg.com") ||
                u.contains("dailymotion.com/cdn") || u.contains("vimeocdn.com")) {
            return true;
        }
        return false;
    }

    private void addDetectedVideo(String streamUrl) {
        if (streamUrl == null || streamUrl.isEmpty()) return;
        if (!detectedMediaUrls.contains(streamUrl)) {
            detectedMediaUrls.add(streamUrl);
            mainHandler.post(this::updateSnifferButton);

            // Auto-download: first video stream found → trigger download after short delay
            // Cancel any previous pending auto-download
            if (autoDownloadRunnable != null) {
                mainHandler.removeCallbacks(autoDownloadRunnable);
            }
            autoDownloadRunnable = () -> {
                if (!detectedMediaUrls.isEmpty()) {
                    // Pick best stream: prefer .mp4 over .m3u8
                    String best = detectedMediaUrls.get(0);
                    for (String u : detectedMediaUrls) {
                        if (u.contains(".mp4") && !best.contains(".mp4")) { best = u; break; }
                    }
                    final String chosen = best;
                    String ext = chosen.contains(".mp3") ? ".mp3" : ".mp4";
                    String filename = "ZDownloader_" + System.currentTimeMillis() + ext;
                    triggerDownload(chosen, filename);

                    // Notify JS UI
                    mainHandler.post(() -> {
                        String js = "if (typeof showToast === 'function') showToast('\u2705 Video detect ho gayi! Download shuru ho rahi hai...');" +
                                "var card = document.getElementById('mProgCard'); if (card) card.classList.remove('show');";
                        webView.evaluateJavascript(js, null);
                    });
                }
                autoDownloadRunnable = null;
            };
            // Wait 1.2 seconds to collect best stream, then auto-download
            mainHandler.postDelayed(autoDownloadRunnable, 1200);
        }
    }

    private void updateSnifferButton() {
        if (btnBrowserSniffer == null) return;
        int count = detectedMediaUrls.size();
        if (count > 0) {
            btnBrowserSniffer.setText("⚡ " + count + " Video" + (count > 1 ? "s" : "") + " Found • Tap to Download");
            btnBrowserSniffer.setVisibility(View.VISIBLE);
        } else {
            btnBrowserSniffer.setVisibility(View.GONE);
        }
    }

    private void showDetectedVideosDialog() {
        if (detectedMediaUrls.isEmpty()) {
            Toast.makeText(MainActivity.this, "No video stream detected yet. Play a video on this page!", Toast.LENGTH_SHORT).show();
            return;
        }

        AlertDialog.Builder builder = new AlertDialog.Builder(MainActivity.this);
        builder.setTitle("⚡ Detected Streams (" + detectedMediaUrls.size() + ")");

        String[] items = new String[detectedMediaUrls.size()];
        for (int i = 0; i < detectedMediaUrls.size(); i++) {
            String u = detectedMediaUrls.get(i);
            String label = "Stream #" + (i + 1) + " • ";
            if (u.contains(".m3u8")) label += "HLS Stream (.m3u8)";
            else if (u.contains(".mp3")) label += "Audio (.mp3)";
            else label += "Direct Video (.mp4)";
            items[i] = label;
        }

        builder.setItems(items, (dialog, which) -> {
            String chosen = detectedMediaUrls.get(which);
            String ext = chosen.contains(".mp3") ? ".mp3" : ".mp4";
            triggerDownload(chosen, "Browser_Video_" + System.currentTimeMillis() + ext);
        });

        builder.setPositiveButton("⬇️ Download Latest", (dialog, which) -> {
            String last = detectedMediaUrls.get(detectedMediaUrls.size() - 1);
            String ext = last.contains(".mp3") ? ".mp3" : ".mp4";
            triggerDownload(last, "Browser_Video_" + System.currentTimeMillis() + ext);
        });

        builder.setNeutralButton("📋 Copy Link", (dialog, which) -> {
            String last = detectedMediaUrls.get(detectedMediaUrls.size() - 1);
            ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm != null) {
                cm.setPrimaryClip(ClipData.newPlainText("Stream URL", last));
                Toast.makeText(MainActivity.this, "📋 Stream link copied to clipboard!", Toast.LENGTH_SHORT).show();
            }
        });

        builder.setNegativeButton("Cancel", null);
        builder.show();
    }

    public void showMiniBrowser(String url) {
        if (miniBrowserLayout != null) {
            miniBrowserLayout.setVisibility(View.VISIBLE);
            if (url != null && !url.trim().isEmpty()) {
                navigateToMiniBrowserUrl(url.trim());
            } else {
                if (miniBrowserWebView != null && (miniBrowserWebView.getUrl() == null || miniBrowserWebView.getUrl().isEmpty())) {
                    miniBrowserWebView.loadUrl("https://www.google.com");
                }
            }
        }
    }

    public void closeMiniBrowser() {
        if (miniBrowserLayout != null) {
            miniBrowserLayout.setVisibility(View.GONE);
        }
        detectedMediaUrls.clear();
        lastMiniBrowserHost = "";
        // Cancel any pending auto-download
        if (autoDownloadRunnable != null) {
            mainHandler.removeCallbacks(autoDownloadRunnable);
            autoDownloadRunnable = null;
        }
        updateSnifferButton();
        if (webView != null) {
            webView.evaluateJavascript("if (typeof onMiniBrowserClosed === 'function') onMiniBrowserClosed();", null);
        }
    }

    @Override
    public void onBackPressed() {
        if (miniBrowserLayout != null && miniBrowserLayout.getVisibility() == View.VISIBLE) {
            if (miniBrowserWebView != null && miniBrowserWebView.canGoBack()) {
                miniBrowserWebView.goBack();
            } else {
                closeMiniBrowser();
            }
            return;
        }
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        destroySniffer();
        if (miniBrowserWebView != null) {
            miniBrowserWebView.stopLoading();
            miniBrowserWebView.destroy();
            miniBrowserWebView = null;
        }
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }
}
