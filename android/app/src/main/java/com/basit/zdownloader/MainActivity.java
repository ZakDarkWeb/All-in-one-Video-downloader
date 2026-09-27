package com.basit.zdownloader;

import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class MainActivity extends AppCompatActivity {

    private WebView webView;
    private String pendingSharedUrl = null;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Hardware accelerated full-screen webview
        webView = new WebView(this);
        setContentView(webView);

        setupWebView();
        handleIntent(getIntent());

        // Load local bundled web app from assets
        webView.loadUrl("file:///android_asset/index.html");
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

    private void injectPendingUrl() {
        if (pendingSharedUrl == null || webView == null) return;
        final String cleanUrl = pendingSharedUrl;
        pendingSharedUrl = null;

        webView.postDelayed(() -> {
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

        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                injectPendingUrl();
            }
        });

        // Native Android DownloadManager Interceptor (Direct to Phone Storage!)
        webView.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimeType, long contentLength) {
                try {
                    DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                    String filename = URLUtil.guessFileName(url, contentDisposition, mimeType);
                    if (!filename.toLowerCase().endsWith(".mp4") && !filename.toLowerCase().endsWith(".mp3")) {
                        filename = "ZDownloader_" + System.currentTimeMillis() + (mimeType.contains("audio") ? ".mp3" : ".mp4");
                    }

                    request.setMimeType(mimeType != null && !mimeType.isEmpty() ? mimeType : "video/mp4");
                    request.addRequestHeader("User-Agent", userAgent);

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
                        Toast.makeText(MainActivity.this, "⬇️ Downloading: " + filename, Toast.LENGTH_SHORT).show();
                    }
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "Download error: " + e.getMessage(), Toast.LENGTH_LONG).show();
                }
            }
        });
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
