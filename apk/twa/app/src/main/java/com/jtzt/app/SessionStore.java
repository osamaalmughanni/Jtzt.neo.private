package com.jtzt.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.webkit.CookieManager;

import androidx.annotation.Nullable;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;

public final class SessionStore {
    private static final String PREFS = "jtzt_session";
    private static final String KEY_LAST_URL = "last_url";
    private static final String KEY_COOKIE = "cookie";
    private static final String KEY_KIOSK_STARTED = "kiosk_started";
    private static final String KEY_WEBVIEW_TEXT_ZOOM = "webview_text_zoom";
    private static final String KEY_SITE_URL = "site_url";
    private static final String KEY_UPDATE_URL = "update_url";
    private static final String HOME_URL = "https://app.jtzt.com/";
    private static final String DEFAULT_UPDATE_URL = "https://app.jtzt.com/jtzt.manifest";
    private static final int DEFAULT_TEXT_ZOOM = 100;

    private SessionStore() {
    }

    public static void restore(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String cookie = prefs.getString(KEY_COOKIE, null);
        if (cookie == null || cookie.trim().isEmpty()) {
            return;
        }

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setCookie(getConfiguredHomeUrl(context), cookie);
        cookieManager.flush();
    }

    public static void persist(Context context, @Nullable String currentUrl) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        SharedPreferences.Editor editor = prefs.edit();
        String homeUrl = getConfiguredHomeUrl(context);
        if (currentUrl != null && !currentUrl.trim().isEmpty() && isSameOrigin(homeUrl, currentUrl)) {
            editor.putString(KEY_LAST_URL, currentUrl);
        } else {
            editor.remove(KEY_LAST_URL);
        }

        String cookie = CookieManager.getInstance().getCookie(getConfiguredHomeUrl(context));
        if (cookie != null && !cookie.trim().isEmpty()) {
            editor.putString(KEY_COOKIE, cookie);
        }
        editor.commit();
        CookieManager.getInstance().flush();
    }

    @Nullable
    public static String getLastUrl(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_LAST_URL, getConfiguredHomeUrl(context));
    }

    public static String getLaunchUrl(Context context) {
        String homeUrl = getConfiguredHomeUrl(context);
        String lastUrl = getLastUrl(context);
        if (lastUrl == null || lastUrl.trim().isEmpty()) {
            return homeUrl;
        }

        if (isSameOrigin(homeUrl, lastUrl)) {
            return lastUrl;
        }

        return homeUrl;
    }

    public static String getConfiguredHomeUrl(Context context) {
        String stored = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_SITE_URL, HOME_URL);
        if (stored == null || stored.trim().isEmpty()) {
            return HOME_URL;
        }

        try {
            return normalizeHomeUrl(stored);
        } catch (IllegalArgumentException ignored) {
            return HOME_URL;
        }
    }

    public static String setConfiguredHomeUrl(Context context, String rawHomeUrl) {
        String normalized = normalizeHomeUrl(rawHomeUrl);
        clearNavigationState(context);
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_SITE_URL, normalized)
                .commit();
        return normalized;
    }

    public static void resetConfiguredHomeUrl(Context context) {
        clearNavigationState(context);
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_SITE_URL, HOME_URL)
                .commit();
    }

    public static void markKioskStarted(Context context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putBoolean(KEY_KIOSK_STARTED, true)
                .commit();
    }

    public static boolean hasKioskStarted(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_KIOSK_STARTED, false);
    }

    public static void setWebViewTextZoom(Context context, int textZoomPercent) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putInt(KEY_WEBVIEW_TEXT_ZOOM, clampPercent(textZoomPercent, DEFAULT_TEXT_ZOOM))
                .commit();
    }

    public static void clearNavigationState(Context context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .remove(KEY_LAST_URL)
                .remove(KEY_COOKIE)
                .commit();
        CookieManager.getInstance().removeAllCookies(null);
        CookieManager.getInstance().flush();
    }

    public static int getWebViewTextZoom(Context context) {
        return clampPercent(
                context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                        .getInt(KEY_WEBVIEW_TEXT_ZOOM, DEFAULT_TEXT_ZOOM),
                DEFAULT_TEXT_ZOOM
        );
    }

    public static String getConfiguredUpdateUrl(Context context) {
        String stored = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_UPDATE_URL, DEFAULT_UPDATE_URL);
        if (stored == null || stored.trim().isEmpty()) {
            return DEFAULT_UPDATE_URL;
        }

        try {
            return normalizeUpdateUrl(stored);
        } catch (IllegalArgumentException ignored) {
            return DEFAULT_UPDATE_URL;
        }
    }

    public static String setConfiguredUpdateUrl(Context context, String rawUpdateUrl) {
        String normalized = normalizeUpdateUrl(rawUpdateUrl);
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_UPDATE_URL, normalized)
                .commit();
        return normalized;
    }

    public static void resetConfiguredUpdateUrl(Context context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_UPDATE_URL, DEFAULT_UPDATE_URL)
                .commit();
    }

    private static int clampPercent(int percent, int fallback) {
        if (percent <= 0) {
            return fallback;
        }

        if (percent < 50) {
            return 50;
        }
        if (percent > 300) {
            return 300;
        }
        return percent;
    }

    private static boolean isSameOrigin(String leftUrl, String rightUrl) {
        try {
            URI left = new URI(leftUrl);
            URI right = new URI(rightUrl);
            return sameOrigin(left, right);
        } catch (URISyntaxException exception) {
            return false;
        }
    }

    public static boolean matchesConfiguredHome(Context context, @Nullable Uri uri) {
        if (context == null || uri == null) {
            return false;
        }

        return isSameOrigin(getConfiguredHomeUrl(context), uri.toString());
    }

    private static String normalizeHomeUrl(String rawHomeUrl) {
        if (rawHomeUrl == null) {
            return HOME_URL;
        }

        String candidate = rawHomeUrl.trim();
        if (candidate.isEmpty()) {
            return HOME_URL;
        }

        if (!candidate.contains("://")) {
            candidate = "https://" + candidate;
        }

        try {
            URI uri = new URI(candidate);
            String scheme = uri.getScheme();
            String host = uri.getHost();
            if (scheme == null || host == null || host.trim().isEmpty()) {
                throw new IllegalArgumentException("Enter a valid domain or full https URL.");
            }

            String normalizedScheme = scheme.toLowerCase(Locale.US);
            if (!"https".equals(normalizedScheme) && !"http".equals(normalizedScheme)) {
                throw new IllegalArgumentException("Only http and https URLs are supported.");
            }

            URI normalizedUri = new URI(
                    normalizedScheme,
                    null,
                    host.toLowerCase(Locale.US),
                    uri.getPort(),
                    "/",
                    null,
                    null
            );
            return normalizedUri.toString();
        } catch (URISyntaxException exception) {
            throw new IllegalArgumentException("Enter a valid domain or full https URL.");
        }
    }

    private static String normalizeUpdateUrl(String rawUpdateUrl) {
        if (rawUpdateUrl == null) {
            return DEFAULT_UPDATE_URL;
        }

        String candidate = rawUpdateUrl.trim();
        if (candidate.isEmpty()) {
            return DEFAULT_UPDATE_URL;
        }

        if (!candidate.contains("://")) {
            candidate = "https://" + candidate;
        }

        try {
            URI uri = new URI(candidate);
            String scheme = uri.getScheme();
            String host = uri.getHost();
            if (scheme == null || host == null || host.trim().isEmpty()) {
                throw new IllegalArgumentException("Enter a valid APK URL.");
            }

            String normalizedScheme = scheme.toLowerCase(Locale.US);
            if (!"https".equals(normalizedScheme) && !"http".equals(normalizedScheme)) {
                throw new IllegalArgumentException("Only http and https URLs are supported.");
            }

            String path = uri.getPath();
            if (path == null || path.trim().isEmpty()) {
                path = "/jtzt.manifest";
            } else if (path.toLowerCase(Locale.US).endsWith(".apk")) {
                path = path.substring(0, path.length() - 4) + ".manifest";
            } else if (!path.toLowerCase(Locale.US).endsWith(".manifest") && !path.toLowerCase(Locale.US).endsWith(".json")) {
                path = path.endsWith("/") ? path + "jtzt.manifest" : path + ".manifest";
            }

            URI normalizedUri = new URI(
                    normalizedScheme,
                    null,
                    host.toLowerCase(Locale.US),
                    uri.getPort(),
                    path,
                    uri.getQuery(),
                    uri.getFragment()
            );
            return normalizedUri.toString();
        } catch (URISyntaxException exception) {
            throw new IllegalArgumentException("Enter a valid APK URL.");
        }
    }

    private static boolean sameOrigin(URI left, URI right) {
        if (left == null || right == null) {
            return false;
        }

        String leftScheme = left.getScheme();
        String rightScheme = right.getScheme();
        String leftHost = left.getHost();
        String rightHost = right.getHost();

        if (leftScheme == null || rightScheme == null || leftHost == null || rightHost == null) {
            return false;
        }

        return leftScheme.equalsIgnoreCase(rightScheme)
                && leftHost.equalsIgnoreCase(rightHost)
                && left.getPort() == right.getPort();
    }
}
