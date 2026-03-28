package com.jtzt.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.webkit.CookieManager;

import androidx.annotation.Nullable;

public final class SessionStore {
    private static final String PREFS = "jtzt_session";
    private static final String KEY_LAST_URL = "last_url";
    private static final String KEY_COOKIE = "cookie";
    private static final String KEY_KIOSK_STARTED = "kiosk_started";
    private static final String HOME_URL = "https://app.jtzt.com/";

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
        cookieManager.setCookie(HOME_URL, cookie);
        cookieManager.flush();
    }

    public static void persist(Context context, @Nullable String currentUrl) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        SharedPreferences.Editor editor = prefs.edit();
        if (currentUrl != null && !currentUrl.trim().isEmpty()) {
            editor.putString(KEY_LAST_URL, currentUrl);
        }

        String cookie = CookieManager.getInstance().getCookie(HOME_URL);
        if (cookie != null && !cookie.trim().isEmpty()) {
            editor.putString(KEY_COOKIE, cookie);
        }
        editor.commit();
        CookieManager.getInstance().flush();
    }

    @Nullable
    public static String getLastUrl(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_LAST_URL, HOME_URL);
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
}
