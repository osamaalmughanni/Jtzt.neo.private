package com.jtzt.app;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.MotionEvent;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;
import android.widget.FrameLayout;

import com.jtzt.app.android.AndroidUiController;
import com.jtzt.app.android.KioskModeController;

public class KioskWebViewActivity extends Activity {
    private static final String HOME_URL = "https://app.jtzt.com/";
    private static final String KIOSK_EXIT_PATH = "/native/exit";
    private static final int MANAGE_TAP_THRESHOLD = 10;
    private static final long MANAGE_TAP_WINDOW_MS = 400L;

    private WebView webView;
    private OnBackInvokedCallback backInvokedCallback;
    private boolean managePageOpening;
    private int rapidTapCount;
    private long lastRapidTapAt;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        AndroidUiController.applyFullscreen(this);
        SessionStore.markKioskStarted(this);

        Uri startUri = getIntent() == null ? null : getIntent().getData();
        if (startUri != null && KIOSK_EXIT_PATH.equals(startUri.getPath())) {
            startActivity(new Intent(this, KioskControllerActivity.class));
            finish();
            return;
        }

        webView = new WebView(this);
        webView.setBackgroundColor(Color.BLACK);
        webView.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setSupportMultipleWindows(false);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccess(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(webView, true);
        SessionStore.restore(this);
        webView.addJavascriptInterface(new NativeStorageBridge(this), "JtztNativeStorage");

        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleUrl(url);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, android.webkit.WebResourceRequest request) {
                Uri uri = request == null ? null : request.getUrl();
                return handleUri(uri);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                SessionStore.persist(KioskWebViewActivity.this, url);
                applyTextZoom();
                super.onPageFinished(view, url);
            }
        });
        webView.setOnTouchListener((view, event) -> {
            if (event != null && event.getActionMasked() == MotionEvent.ACTION_DOWN) {
                maybeOpenManagePageFromRapidTaps();
            }
            return false;
        });

        FrameLayout root = new FrameLayout(this);
        root.addView(webView);
        setContentView(root);

        applyTextZoom();
        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            String startUrl = SessionStore.getLastUrl(this);
            webView.loadUrl(startUrl == null ? HOME_URL : startUrl);
        }

        registerBackHandler();
    }

    @Override
    protected void onResume() {
        super.onResume();
        managePageOpening = false;
        AndroidUiController.applyFullscreen(this);
        KioskModeController.enter(this);
        applyTextZoom();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            AndroidUiController.applyFullscreen(this);
            KioskModeController.enter(this);
        }
    }

    @Override
    protected void onPause() {
        if (webView != null) {
            SessionStore.persist(this, webView.getUrl());
        }
        super.onPause();
    }

    @Override
    protected void onStop() {
        super.onStop();
        if (!isFinishing()) {
            SessionStore.persist(this, webView == null ? null : webView.getUrl());
        }
    }

    @Override
    protected void onDestroy() {
        unregisterBackHandler();
        if (webView != null) {
            SessionStore.persist(this, webView.getUrl());
        }
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) {
            webView.saveState(outState);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        Uri uri = intent == null ? null : intent.getData();
        if (uri != null && KIOSK_EXIT_PATH.equals(uri.getPath())) {
            startActivity(new Intent(this, KioskControllerActivity.class));
            return;
        }
        if (webView != null && uri != null) {
            webView.loadUrl(uri.toString());
        }
    }

    @Override
    public void onUserLeaveHint() {
        super.onUserLeaveHint();
        if (KioskModeController.shouldEnforce(this)) {
            KioskModeController.enter(this);
        }
    }

    @Override
    public void onBackPressed() {
        handleBackNavigation();
    }

    private boolean handleUrl(String url) {
        return handleUri(url == null ? null : Uri.parse(url));
    }

    private boolean handleUri(Uri uri) {
        if (uri == null) {
            return true;
        }

        if ("https".equals(uri.getScheme()) && "app.jtzt.com".equals(uri.getHost())) {
            if (KIOSK_EXIT_PATH.equals(uri.getPath())) {
                openExitGate();
                return true;
            }
            return false;
        }

        return true;
    }

    private void openExitGate() {
        if (managePageOpening || isFinishing()) {
            return;
        }

        managePageOpening = true;
        Intent intent = new Intent(this, KioskControllerActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        startActivity(intent);
    }

    private void maybeOpenManagePageFromRapidTaps() {
        long now = SystemClock.elapsedRealtime();
        if (now - lastRapidTapAt > MANAGE_TAP_WINDOW_MS) {
            rapidTapCount = 0;
        }
        lastRapidTapAt = now;
        rapidTapCount += 1;
        if (rapidTapCount >= MANAGE_TAP_THRESHOLD) {
            rapidTapCount = 0;
            openExitGate();
        }
    }

    private void handleBackNavigation() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }

        openExitGate();
    }

    private void applyTextZoom() {
        if (webView == null) {
            return;
        }

        int textZoom = SessionStore.getWebViewTextZoom(this);
        WebSettings settings = webView.getSettings();
        settings.setTextZoom(textZoom);
    }

    private void registerBackHandler() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || backInvokedCallback != null) {
            return;
        }

        backInvokedCallback = this::handleBackNavigation;
        getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                backInvokedCallback
        );
    }

    private void unregisterBackHandler() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || backInvokedCallback == null) {
            return;
        }

        getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backInvokedCallback);
        backInvokedCallback = null;
    }
}
