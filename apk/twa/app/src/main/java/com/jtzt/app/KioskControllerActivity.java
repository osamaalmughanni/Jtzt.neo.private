package com.jtzt.app;

import android.app.Activity;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.ViewGroup;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import com.jtzt.app.android.KioskModeController;

public class KioskControllerActivity extends Activity {
    private TextView launcherStatus;
    private Button launcherPrimaryButton;
    private Button launcherSettingsButton;
    private Button exitButton;
    private OnBackInvokedCallback backInvokedCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        ScrollView scrollView = new ScrollView(this);
        scrollView.setFillViewport(true);
        scrollView.setBackgroundColor(0xFF000000);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        root.setPadding(dp(20), dp(22), dp(20), dp(22));
        root.setLayoutParams(new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));
        root.setGravity(Gravity.CENTER_HORIZONTAL | Gravity.CENTER_VERTICAL);

        TextView title = new TextView(this);
        title.setText("Manage Jtzt");
        title.setTextColor(0xFFFFFFFF);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        title.setGravity(Gravity.CENTER);

        TextView subtitle = new TextView(this);
        subtitle.setText("Open the app, change launcher, or exit.");
        subtitle.setTextColor(0xFFB0B0B0);
        subtitle.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        subtitle.setGravity(Gravity.CENTER);

        launcherStatus = new TextView(this);
        launcherStatus.setTextColor(0xFFE0E0E0);
        launcherStatus.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        launcherStatus.setGravity(Gravity.CENTER);

        Button openAppButton = new Button(this);
        openAppButton.setText("Open Jtzt");
        openAppButton.setAllCaps(false);
        openAppButton.setOnClickListener(v -> returnToKiosk());

        launcherPrimaryButton = new Button(this);
        launcherPrimaryButton.setAllCaps(false);
        launcherPrimaryButton.setOnClickListener(v -> HomeRoleHelper.requestDefaultHome(this));

        launcherSettingsButton = new Button(this);
        launcherSettingsButton.setAllCaps(false);
        launcherSettingsButton.setOnClickListener(v -> HomeRoleHelper.openLauncherSettings(this));

        exitButton = new Button(this);
        exitButton.setText("Exit Jtzt");
        exitButton.setAllCaps(false);
        exitButton.setOnClickListener(v -> exitApp());

        root.addView(title, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        LinearLayout.LayoutParams subtitleParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        subtitleParams.topMargin = dp(8);
        root.addView(subtitle, subtitleParams);
        LinearLayout.LayoutParams launcherStatusParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        launcherStatusParams.topMargin = dp(14);
        root.addView(launcherStatus, launcherStatusParams);
        LinearLayout.LayoutParams openAppParams = fullWidthParams(dp(16));
        root.addView(openAppButton, openAppParams);
        LinearLayout.LayoutParams launcherPrimaryParams = fullWidthParams(dp(10));
        root.addView(launcherPrimaryButton, launcherPrimaryParams);
        LinearLayout.LayoutParams launcherSettingsParams = fullWidthParams(dp(8));
        root.addView(launcherSettingsButton, launcherSettingsParams);
        LinearLayout.LayoutParams buttonParams = fullWidthParams(dp(14));
        root.addView(exitButton, buttonParams);
        scrollView.addView(root);

        setContentView(scrollView);
        registerBackHandler();
    }

    @Override
    protected void onResume() {
        super.onResume();
        KioskModeController.enter(this);
        syncLauncherControls();
    }

    @Override
    protected void onDestroy() {
        unregisterBackHandler();
        super.onDestroy();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            KioskModeController.enter(this);
        }
    }

    @Override
    public void onBackPressed() {
        returnToKiosk();
    }

    private void exitApp() {
        KioskModeController.exit(this);
        finishAffinity();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            finishAndRemoveTask();
        } else {
            finish();
        }
    }

    private void returnToKiosk() {
        Intent intent = new Intent(this, KioskWebViewActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivity(intent);
        finish();
    }

    private void syncLauncherControls() {
        boolean isDefaultHome = HomeRoleHelper.isDefaultHome(this);
        launcherStatus.setText(isDefaultHome
                ? "Jtzt controls Home. Change launcher to enable exit."
                : "Jtzt is not launcher. Exit is available.");
        launcherPrimaryButton.setText(isDefaultHome ? "Jtzt is launcher" : "Set as launcher");
        launcherPrimaryButton.setEnabled(!isDefaultHome);
        launcherPrimaryButton.setAlpha(isDefaultHome ? 0.65f : 1f);
        launcherSettingsButton.setText(isDefaultHome ? "Change launcher" : "Open launcher settings");
        exitButton.setEnabled(!isDefaultHome);
        exitButton.setAlpha(isDefaultHome ? 0.55f : 1f);
        exitButton.setText(isDefaultHome ? "Exit unavailable while Jtzt is launcher" : "Exit Jtzt");
    }

    private LinearLayout.LayoutParams fullWidthParams(int topMarginDp) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        params.topMargin = dp(topMarginDp);
        return params;
    }

    private int dp(int value) {
        return Math.round(getResources().getDisplayMetrics().density * value);
    }

    private void registerBackHandler() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || backInvokedCallback != null) {
            return;
        }

        backInvokedCallback = this::returnToKiosk;
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
