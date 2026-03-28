package com.jtzt.app;

import android.app.Activity;
import android.app.AlertDialog;
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

import com.jtzt.app.android.AndroidUiController;
import com.jtzt.app.android.KioskModeController;

public class KioskControllerActivity extends Activity {
    private TextView deviceState;
    private TextView launcherStatus;
    private TextView lockdownHint;
    private Button adminButton;
    private Button adminSettingsButton;
    private Button dedicatedSetupButton;
    private Button launcherPrimaryButton;
    private Button launcherSettingsButton;
    private Button exitButton;
    private OnBackInvokedCallback backInvokedCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        AndroidUiController.applyFullscreen(this);

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
        subtitle.setText("Keep this device focused on Jtzt.");
        subtitle.setTextColor(0xFFB0B0B0);
        subtitle.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        subtitle.setGravity(Gravity.CENTER);

        deviceState = new TextView(this);
        deviceState.setTextColor(0xFFFFFFFF);
        deviceState.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        deviceState.setGravity(Gravity.CENTER);

        launcherStatus = new TextView(this);
        launcherStatus.setTextColor(0xFFE0E0E0);
        launcherStatus.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        launcherStatus.setGravity(Gravity.CENTER);

        lockdownHint = new TextView(this);
        lockdownHint.setTextColor(0xFF9A9A9A);
        lockdownHint.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        lockdownHint.setGravity(Gravity.CENTER);

        Button openAppButton = new Button(this);
        openAppButton.setText("Open Jtzt");
        openAppButton.setAllCaps(false);
        openAppButton.setOnClickListener(v -> returnToKiosk());

        adminButton = new Button(this);
        adminButton.setAllCaps(false);
        adminButton.setOnClickListener(v -> DevicePolicyHelper.requestDeviceAdmin(this));

        adminSettingsButton = new Button(this);
        adminSettingsButton.setAllCaps(false);
        adminSettingsButton.setOnClickListener(v -> DevicePolicyHelper.openDeviceAdminSettings(this));

        dedicatedSetupButton = new Button(this);
        dedicatedSetupButton.setText("Dedicated setup");
        dedicatedSetupButton.setAllCaps(false);
        dedicatedSetupButton.setOnClickListener(v -> showDedicatedSetupDialog());

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
        LinearLayout.LayoutParams deviceStateParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        deviceStateParams.topMargin = dp(14);
        root.addView(deviceState, deviceStateParams);
        LinearLayout.LayoutParams launcherStatusParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        launcherStatusParams.topMargin = dp(8);
        root.addView(launcherStatus, launcherStatusParams);
        LinearLayout.LayoutParams hintParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        hintParams.topMargin = dp(12);
        root.addView(lockdownHint, hintParams);
        LinearLayout.LayoutParams openAppParams = fullWidthParams(dp(16));
        root.addView(openAppButton, openAppParams);
        LinearLayout.LayoutParams adminParams = fullWidthParams(dp(10));
        root.addView(adminButton, adminParams);
        LinearLayout.LayoutParams adminSettingsParams = fullWidthParams(dp(8));
        root.addView(adminSettingsButton, adminSettingsParams);
        LinearLayout.LayoutParams dedicatedSetupParams = fullWidthParams(dp(8));
        root.addView(dedicatedSetupButton, dedicatedSetupParams);
        LinearLayout.LayoutParams launcherPrimaryParams = fullWidthParams(dp(12));
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
        AndroidUiController.applyFullscreen(this);
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
            AndroidUiController.applyFullscreen(this);
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
        boolean isAdminActive = DevicePolicyHelper.isDeviceAdminActive(this);
        boolean isDeviceOwner = DevicePolicyHelper.isDeviceOwner(this);
        boolean isLockTaskPermitted = DevicePolicyHelper.isLockTaskPermitted(this);
        boolean isLockTaskActive = DevicePolicyHelper.isLockTaskActive(this);
        boolean isDefaultHome = HomeRoleHelper.isDefaultHome(this);

        if (isDeviceOwner) {
            deviceState.setText(isLockTaskActive
                    ? "Dedicated lock mode is active."
                    : "Dedicated lock mode is ready.");
        } else if (isAdminActive) {
            deviceState.setText("Device admin is enabled. Full lockdown still needs dedicated-device setup.");
        } else {
            deviceState.setText("This device is using launcher mode only.");
        }

        launcherStatus.setText(isDefaultHome
                ? "Jtzt controls Home. Change launcher to enable exit."
                : "Jtzt is not launcher. Exit is available.");
        lockdownHint.setText(isDeviceOwner
                ? "Device owner is active, so Jtzt can apply the strongest Android lockdown policies."
                : "Android only grants device owner during provisioning on a fresh device. Enable admin here, then finish dedicated-device setup separately.");

        adminButton.setText(isAdminActive ? "Device admin is enabled" : "Enable device admin");
        adminButton.setEnabled(!isAdminActive);
        adminButton.setAlpha(isAdminActive ? 0.65f : 1f);
        adminSettingsButton.setText(isAdminActive ? "Review security settings" : "Open security settings");
        launcherPrimaryButton.setText(isDefaultHome ? "Jtzt is launcher" : "Set as launcher");
        launcherPrimaryButton.setEnabled(!isDefaultHome);
        launcherPrimaryButton.setAlpha(isDefaultHome ? 0.65f : 1f);
        launcherSettingsButton.setText(isDefaultHome ? "Change launcher" : "Open launcher settings");
        exitButton.setEnabled(!isDefaultHome);
        exitButton.setAlpha(!isDefaultHome ? 1f : 0.55f);
        if (isDefaultHome) {
            exitButton.setText("Exit unavailable while Jtzt is launcher");
        } else {
            exitButton.setText("Exit Jtzt");
        }
    }

    private void showDedicatedSetupDialog() {
        String message =
                "Jtzt cannot become device owner from a normal permission prompt. Android only grants that role during dedicated-device provisioning."
                        + "\n\nFastest path:"
                        + "\n1. Start from a fresh device with no accounts."
                        + "\n2. Install Jtzt and enable device admin."
                        + "\n3. Provision device owner with adb or QR enrollment."
                        + "\n4. Reopen Jtzt and lock task will apply fully.";

        new AlertDialog.Builder(this)
                .setTitle("Dedicated setup")
                .setMessage(message)
                .setPositiveButton("Back to Jtzt", (dialog, which) -> dialog.dismiss())
                .show();
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
