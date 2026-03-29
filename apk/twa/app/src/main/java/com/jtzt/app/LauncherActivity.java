package com.jtzt.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

public class LauncherActivity extends Activity {
    private static final String KIOSK_EXIT_PATH = "/native/exit";

    private boolean isKioskExitRequest() {
        Uri data = getIntent() == null ? null : getIntent().getData();
        return data != null
                && "https".equals(data.getScheme())
                && SessionStore.matchesConfiguredHome(this, data)
                && KIOSK_EXIT_PATH.equals(data.getPath());
    }

    private boolean isHomeLaunch() {
        Intent intent = getIntent();
        return intent != null
                && Intent.ACTION_MAIN.equals(intent.getAction())
                && intent.hasCategory(Intent.CATEGORY_HOME);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (isKioskExitRequest()) {
            startActivity(new Intent(this, KioskControllerActivity.class));
            finish();
            return;
        }

        Intent launchIntent = new Intent(this, KioskWebViewActivity.class);
        if (isHomeLaunch() && SessionStore.hasKioskStarted(this)) {
            launchIntent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        }
        launchIntent.setData(Uri.parse(SessionStore.getConfiguredHomeUrl(this)));
        startActivity(launchIntent);
        finish();
    }
}
