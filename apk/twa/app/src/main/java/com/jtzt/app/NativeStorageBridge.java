package com.jtzt.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.webkit.JavascriptInterface;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

public class NativeStorageBridge {
    public static final String PREFS = "jtzt_native_web_state";
    public static final String VIEWPORT_FACTOR_KEY = "jtzt.android.viewport.factor";
    private static final Set<String> ALLOWED_KEYS = new HashSet<>(Arrays.asList(
            "jtzt.company.session",
            "jtzt.admin.session",
            "jtzt.tablet.access",
            "jtzt.language",
            "jtzt.theme",
            VIEWPORT_FACTOR_KEY
    ));

    private final SharedPreferences preferences;

    public NativeStorageBridge(Context context) {
        preferences = context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    @JavascriptInterface
    public String getItem(String key) {
        if (!ALLOWED_KEYS.contains(key)) {
            return null;
        }

        return preferences.getString(key, null);
    }

    @JavascriptInterface
    public void setItem(String key, String value) {
        if (!ALLOWED_KEYS.contains(key) || value == null) {
            return;
        }

        preferences.edit().putString(key, value).commit();
    }

    @JavascriptInterface
    public void removeItem(String key) {
        if (!ALLOWED_KEYS.contains(key)) {
            return;
        }

        preferences.edit().remove(key).commit();
    }

    public static void setViewportFactor(Context context, float factor) {
        if (context == null) {
            return;
        }

        context.getApplicationContext()
                .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(VIEWPORT_FACTOR_KEY, String.valueOf(clampViewportFactor(factor)))
                .commit();
    }

    public static float getViewportFactor(Context context) {
        if (context == null) {
            return 1.0f;
        }

        String rawValue = context.getApplicationContext()
                .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(VIEWPORT_FACTOR_KEY, null);
        if (rawValue == null || rawValue.trim().isEmpty()) {
            return 1.0f;
        }

        try {
            return clampViewportFactor(Float.parseFloat(rawValue));
        } catch (NumberFormatException exception) {
            return 1.0f;
        }
    }

    private static float clampViewportFactor(float factor) {
        if (Float.isNaN(factor) || Float.isInfinite(factor)) {
            return 1.0f;
        }

        if (factor < 0.5f) {
            return 0.5f;
        }
        if (factor > 2.0f) {
            return 2.0f;
        }
        return factor;
    }
}
