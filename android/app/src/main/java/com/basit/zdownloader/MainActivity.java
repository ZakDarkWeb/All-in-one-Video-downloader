package com.basit.zdownloader;

import android.app.DownloadManager;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
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
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.FileProvider;
import android.media.MediaScannerConnection;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.text.DecimalFormat;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

public class MainActivity extends AppCompatActivity {

    private WebView webView;
    private WebView snifferWebView = null;
    private String pendingSharedUrl = null;
    private String lastAutoPastedUrl = "";
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private Runnable snifferTimeoutRunnable = null;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        setContentView(webView);

        setupWebView();
        handleIntent(getIntent());

        // Load local bundled web app from assets
        webView.loadUrl("file:///android_asset/index.html");
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
                            mainHandler.postDelayed(() -> {
                                String js = "javascript:(function() {" +
                                        "  var inp = document.getElementById('mUrlInput');" +
                                        "  if (inp && (!inp.value || inp.value !== '" + foundUrl.replace("'", "\\'") + "')) {" +
                                        "    inp.value = '" + foundUrl.replace("'", "\\'") + "';" +
                                        "    if (typeof showToast === 'function') showToast('📋 Link clipboard se auto-paste ho gaya!');" +
                                        "    if (typeof openClipSheet === 'function') openClipSheet('" + foundUrl.replace("'", "\\'") + "', 'clipboard');" +
                                        "  }" +
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
                    "  var inp = document.getElementById('mUrlInput');" +
                    "  if (inp) {" +
                    "    inp.value = '" + cleanUrl.replace("'", "\\'") + "';" +
                    "    var btn = document.getElementById('mStartDlBtn');" +
                    "    if (btn) btn.click();" +
                    "  }" +
                    "})();";
            webView.evaluateJavascript(js, null);
        }, 1000);
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

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
            CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);
        }

        // Expose Native Android JS Bridge
        webView.addJavascriptInterface(new WebAppInterface(), "Android");

        webView.setWebChromeClient(new WebChromeClient());
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
                // Block external ad/redirect sites (like snapinsta, fastdl, ads) from taking over
                if (targetUrl.startsWith("file:///android_asset/")) {
                    return false;
                }
                // If it's a direct media download link, intercept it
                if (isMediaUrl(targetUrl)) {
                    triggerDownload(targetUrl, "video_" + System.currentTimeMillis() + ".mp4");
                    return true;
                }
                // Do not redirect away from app
                return true;
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
        return u.endsWith(".mp4") || u.endsWith(".mp3") || u.endsWith(".mkv") || u.endsWith(".webm") ||
                u.contains(".mp4?") || u.contains("snapcdn.app") || (u.contains("fbcdn.net") && u.contains(".mp4"));
    }

    public void triggerDownload(String url, String filename) {
        try {
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            if (!filename.toLowerCase().endsWith(".mp4") && !filename.toLowerCase().endsWith(".mp3")) {
                filename = "ZDownloader_" + System.currentTimeMillis() + ".mp4";
            }

            String mimeType = filename.endsWith(".mp3") ? "audio/mpeg" : "video/mp4";
            request.setMimeType(mimeType);
            request.addRequestHeader("User-Agent", "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36");

            String cookies = CookieManager.getInstance().getCookie(url);
            if (cookies != null) {
                request.addRequestHeader("Cookie", cookies);
            }

            request.setTitle(filename);
            request.setDescription("Downloading video via ZDownloader PRO");
            request.allowScanningByMediaScanner();
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename);

            DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            if (dm != null) {
                dm.enqueue(request);
                Toast.makeText(MainActivity.this, "⬇️ Direct Download Started: " + filename, Toast.LENGTH_SHORT).show();
            }

            // Notify webView of success and reset buttons
            mainHandler.post(() -> {
                String js = "if (typeof showToast === 'function') showToast('✅ Video aapke phone me direct save ho rahi hai!');" +
                        "var st = document.getElementById('mProgStatus'); if (st) st.textContent = '✅ Download Started in Android Bar!';" +
                        "var pct = document.getElementById('mProgPct'); if (pct) pct.textContent = '100%';" +
                        "var fill = document.getElementById('mProgFill'); if (fill) fill.style.width = '100%';" +
                        "var btn = document.getElementById('mStartDlBtn'); if (btn) { btn.disabled = false; btn.innerHTML = '<span>⚡ Start Download</span>'; }";
                webView.evaluateJavascript(js, null);
            });
        } catch (Exception e) {
            Toast.makeText(MainActivity.this, "Download error: " + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    // ── In-App Background Sniffer for Instagram (No External Redirects!) ──
    private void startInstagramSniffer(String igUrl) {
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
            s.setUserAgentString("Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36");

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                CookieManager.getInstance().setAcceptThirdPartyCookies(snifferWebView, true);
            }

            // Interface for the injected JS extractor
            snifferWebView.addJavascriptInterface(new Object() {
                @JavascriptInterface
                public void onStreamFound(String streamUrl) {
                    if (streamUrl != null && !streamUrl.isEmpty()) {
                        mainHandler.post(() -> {
                            triggerDownload(streamUrl, "Instagram_Reel_" + System.currentTimeMillis() + ".mp4");
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

                    if (isInstagramStream(reqUrl)) {
                        streamCaptured = true;
                        mainHandler.post(() -> {
                            triggerDownload(reqUrl, "Instagram_Reel_" + System.currentTimeMillis() + ".mp4");
                            destroySniffer();
                        });
                    }
                    return super.shouldInterceptRequest(view, request);
                }

                @Override
                public void onPageFinished(WebView view, String url) {
                    super.onPageFinished(view, url);
                    if (streamCaptured) return;

                    // Inject smart extractor to scrape video tags, meta tags, or inline JSON
                    String js = "(function() {" +
                            "  function check() {" +
                            "    var vids = document.querySelectorAll('video');" +
                            "    for (var i = 0; i < vids.length; i++) {" +
                            "      var s = vids[i].currentSrc || vids[i].src;" +
                            "      if (!s) { var sc = vids[i].querySelector('source'); if (sc) s = sc.src; }" +
                            "      if (s && s.startsWith('http') && !s.startsWith('blob:') && (s.includes('fbcdn.net') || s.includes('cdninstagram.com') || s.includes('.mp4'))) {" +
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
                            "      var m = t.match(/https:\\/\\/[^\\s\"'><\\\\]+(?:fbcdn\\.net|cdninstagram\\.com)[^\\s\"'><\\\\]*(?:\\.mp4|\\/t50\\.)[^\\s\"'><\\\\]*/);" +
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
                            "    var iv = setInterval(function() { if (check()) clearInterval(iv); }, 500);" +
                            "    setTimeout(function() { clearInterval(iv); }, 12000);" +
                            "  }" +
                            "})();";
                    view.evaluateJavascript(js, null);
                }
            });

            // Auto-cancel after 15 seconds if not captured
            snifferTimeoutRunnable = () -> {
                if (snifferWebView != null) {
                    destroySniffer();
                    mainHandler.post(() -> {
                        String js = "if (typeof showToast === 'function') showToast('⚠️ Instagram video direct detect nahi ho saki. Account ya link public hona zaroori hai.');" +
                                "var st = document.getElementById('mProgStatus'); if (st) st.textContent = '❌ Download Timeout: Link public hona zaroori hai.';" +
                                "var btn = document.getElementById('mStartDlBtn'); if (btn) { btn.disabled = false; btn.innerHTML = '<span>⚡ Start Download</span>'; }";
                        webView.evaluateJavascript(js, null);
                    });
                }
            };
            mainHandler.postDelayed(snifferTimeoutRunnable, 15000);

            // Clean shortcode and choose best URL
            String shortcode = extractInstagramShortcode(igUrl);
            if (shortcode != null) {
                // Embed URL bypasses login restrictions and triggers media load immediately
                snifferWebView.loadUrl("https://www.instagram.com/p/" + shortcode + "/embed/captioned/");
            } else {
                snifferWebView.loadUrl(igUrl);
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

    private boolean isInstagramStream(String url) {
        if (url == null) return false;
        String u = url.toLowerCase();
        if (u.contains(".js") || u.contains(".css") || u.contains("analytics") || u.contains("logging") || u.contains("favicon")) {
            return false;
        }
        boolean isCdn = u.contains("fbcdn.net") || u.contains("cdninstagram.com");
        if (isCdn) {
            if (u.contains(".mp4") || u.contains("/t50.") || u.contains("video") || u.contains("bytestart") || u.contains("mime=video") || u.contains("video_dashinit")) {
                return true;
            }
        }
        return false;
    }

    private void destroySniffer() {
        if (snifferTimeoutRunnable != null) {
            mainHandler.removeCallbacks(snifferTimeoutRunnable);
            snifferTimeoutRunnable = null;
        }
        if (snifferWebView != null) {
            snifferWebView.stopLoading();
            snifferWebView.destroy();
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
        public void sniffAndDownloadInstagram(String igUrl) {
            startInstagramSniffer(igUrl);
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

        private String formatFileSize(long bytes) {
            if (bytes <= 0) return "0 B";
            if (bytes < 1024) return bytes + " B";
            if (bytes < 1024 * 1024) return new DecimalFormat("#.0").format((double) bytes / 1024) + " KB";
            return new DecimalFormat("#.00").format((double) bytes / (1024 * 1024)) + " MB";
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        destroySniffer();
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }
}
