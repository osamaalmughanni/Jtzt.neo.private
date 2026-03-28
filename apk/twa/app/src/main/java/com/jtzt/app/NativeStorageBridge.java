package com.jtzt.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.webkit.JavascriptInterface;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

public class NativeStorageBridge {
    private static final String PREFS = "jtzt_native_web_state";
    private static final Set<String> ALLOWED_KEYS = new HashSet<>(Arrays.asList(
            "jtzt.company.session",
            "jtzt.admin.session",
            "jtzt.tablet.access",
            "jtzt.language",
            "jtzt.theme"
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
}
