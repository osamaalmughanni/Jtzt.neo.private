package com.jtzt.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.EditText;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.provider.Settings;

import com.jtzt.app.android.AndroidUiController;
import com.jtzt.app.android.KioskModeController;

import java.io.File;

public class KioskControllerActivity extends Activity {
    private TextView domainStatus;
    private EditText domainInput;
    private Button domainSaveButton;
    private Button domainResetButton;
    private TextView updateTitle;
    private TextView updateDescription;
    private EditText updateInput;
    private TextView updateStatus;
    private Button updateSaveButton;
    private Button updateResetButton;
    private Button updateCheckButton;
    private Button updateForceButton;
    private TextView deviceState;
    private TextView launcherStatus;
    private TextView lockdownHint;
    private EditText textZoomInput;
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

        TextView domainTitle = new TextView(this);
        domainTitle.setText("Custom domain");
        domainTitle.setTextColor(0xFFFFFFFF);
        domainTitle.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        domainTitle.setGravity(Gravity.CENTER_HORIZONTAL);

        TextView domainDescription = new TextView(this);
        domainDescription.setText("Stored locally on this device. Change the website, or reset back to the default if the site does not load.");
        domainDescription.setTextColor(0xFFB0B0B0);
        domainDescription.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        domainDescription.setGravity(Gravity.CENTER_HORIZONTAL);

        domainInput = buildTextInput("https://app.jtzt.com/");

        domainStatus = new TextView(this);
        domainStatus.setTextColor(0xFFE0E0E0);
        domainStatus.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        domainStatus.setGravity(Gravity.CENTER_HORIZONTAL);

        domainSaveButton = new Button(this);
        domainSaveButton.setText("Save website");
        domainSaveButton.setAllCaps(false);
        domainSaveButton.setOnClickListener(v -> applyDomainSetting());

        domainResetButton = new Button(this);
        domainResetButton.setText("Reset to default");
        domainResetButton.setAllCaps(false);
        domainResetButton.setOnClickListener(v -> resetDomainSetting());

        updateTitle = new TextView(this);
        updateTitle.setText("APK update");
        updateTitle.setTextColor(0xFFFFFFFF);
        updateTitle.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        updateTitle.setGravity(Gravity.CENTER_HORIZONTAL);

        updateDescription = new TextView(this);
        updateDescription.setText("Keep a verified update manifest here, check for newer builds, and force-install the latest package.");
        updateDescription.setTextColor(0xFFB0B0B0);
        updateDescription.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        updateDescription.setGravity(Gravity.CENTER_HORIZONTAL);

        updateInput = buildTextInput("https://app.jtzt.com/jtzt.manifest");

        updateStatus = new TextView(this);
        updateStatus.setTextColor(0xFFE0E0E0);
        updateStatus.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        updateStatus.setGravity(Gravity.CENTER_HORIZONTAL);

        updateSaveButton = new Button(this);
        updateSaveButton.setText("Save manifest");
        updateSaveButton.setAllCaps(false);
        updateSaveButton.setOnClickListener(v -> applyUpdateSetting());

        updateResetButton = new Button(this);
        updateResetButton.setText("Reset manifest");
        updateResetButton.setAllCaps(false);
        updateResetButton.setOnClickListener(v -> resetUpdateSetting());

        updateCheckButton = new Button(this);
        updateCheckButton.setText("Check version");
        updateCheckButton.setAllCaps(false);
        updateCheckButton.setOnClickListener(v -> checkUpdateAvailability());

        updateForceButton = new Button(this);
        updateForceButton.setText("Force update");
        updateForceButton.setAllCaps(false);
        updateForceButton.setOnClickListener(v -> forceUpdateInstall());

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

        textZoomInput = buildNumberInput("Text zoom % e.g. 110");

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

        Button applyScaleButton = new Button(this);
        applyScaleButton.setText("Apply text zoom");
        applyScaleButton.setAllCaps(false);
        applyScaleButton.setOnClickListener(v -> applyScaleSetting());

        Button resetScaleButton = new Button(this);
        resetScaleButton.setText("Reset text zoom");
        resetScaleButton.setAllCaps(false);
        resetScaleButton.setOnClickListener(v -> resetScaleSetting());

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
        LinearLayout.LayoutParams domainTitleParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        domainTitleParams.topMargin = dp(18);
        root.addView(domainTitle, domainTitleParams);
        LinearLayout.LayoutParams domainDescriptionParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        domainDescriptionParams.topMargin = dp(4);
        root.addView(domainDescription, domainDescriptionParams);
        LinearLayout.LayoutParams domainInputParams = fullWidthParams(dp(12));
        root.addView(domainInput, domainInputParams);
        LinearLayout.LayoutParams domainStatusParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        domainStatusParams.topMargin = dp(8);
        root.addView(domainStatus, domainStatusParams);
        LinearLayout.LayoutParams domainSaveParams = fullWidthParams(dp(8));
        root.addView(domainSaveButton, domainSaveParams);
        LinearLayout.LayoutParams domainResetParams = fullWidthParams(dp(8));
        root.addView(domainResetButton, domainResetParams);
        LinearLayout.LayoutParams updateTitleParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        updateTitleParams.topMargin = dp(18);
        root.addView(updateTitle, updateTitleParams);
        LinearLayout.LayoutParams updateDescriptionParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        updateDescriptionParams.topMargin = dp(4);
        root.addView(updateDescription, updateDescriptionParams);
        LinearLayout.LayoutParams updateInputParams = fullWidthParams(dp(12));
        root.addView(updateInput, updateInputParams);
        LinearLayout.LayoutParams updateStatusParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        updateStatusParams.topMargin = dp(8);
        root.addView(updateStatus, updateStatusParams);
        LinearLayout.LayoutParams updateSaveParams = fullWidthParams(dp(8));
        root.addView(updateSaveButton, updateSaveParams);
        LinearLayout.LayoutParams updateResetParams = fullWidthParams(dp(8));
        root.addView(updateResetButton, updateResetParams);
        LinearLayout.LayoutParams updateCheckParams = fullWidthParams(dp(8));
        root.addView(updateCheckButton, updateCheckParams);
        LinearLayout.LayoutParams updateForceParams = fullWidthParams(dp(8));
        root.addView(updateForceButton, updateForceParams);
        LinearLayout.LayoutParams deviceStateParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        deviceStateParams.topMargin = dp(18);
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
        LinearLayout.LayoutParams textZoomParams = fullWidthParams(dp(12));
        root.addView(textZoomInput, textZoomParams);
        LinearLayout.LayoutParams applyScaleParams = fullWidthParams(dp(8));
        root.addView(applyScaleButton, applyScaleParams);
        LinearLayout.LayoutParams resetScaleParams = fullWidthParams(dp(8));
        root.addView(resetScaleButton, resetScaleParams);
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
        intent.setData(Uri.parse(SessionStore.getConfiguredHomeUrl(this)));
        startActivity(intent);
        finish();
    }

    private void syncLauncherControls() {
        boolean isAdminActive = DevicePolicyHelper.isDeviceAdminActive(this);
        boolean isDeviceOwner = DevicePolicyHelper.isDeviceOwner(this);
        boolean isLockTaskActive = DevicePolicyHelper.isLockTaskActive(this);
        boolean isDefaultHome = HomeRoleHelper.isDefaultHome(this);
        String configuredHomeUrl = SessionStore.getConfiguredHomeUrl(this);
        String configuredUpdateUrl = SessionStore.getConfiguredUpdateUrl(this);
        domainInput.setText(configuredHomeUrl);
        domainStatus.setText("Active domain: " + configuredHomeUrl);
        updateInput.setText(configuredUpdateUrl);
        if (updateStatus != null) {
            if (updateStatus.getTag() instanceof String) {
                updateStatus.setText((String) updateStatus.getTag());
            } else {
                updateStatus.setText("Installed APK: " + ApkUpdateManager.getInstalledVersionCode(this) + " (" + ApkUpdateManager.getInstalledVersionName(this) + ") | Tap Check version to compare.");
            }
        }
        textZoomInput.setText(String.valueOf(SessionStore.getWebViewTextZoom(this)));

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

    private void applyDomainSetting() {
        String rawValue = readInput(domainInput);
        if (rawValue.isEmpty()) {
            showDomainError("Enter a domain or full https URL.");
            return;
        }

        try {
            String normalized = SessionStore.setConfiguredHomeUrl(this, rawValue);
            domainInput.setText(normalized);
            domainStatus.setText("Active domain: " + normalized);
            returnToKiosk();
        } catch (IllegalArgumentException exception) {
            showDomainError(exception.getMessage());
        }
    }

    private void resetDomainSetting() {
        SessionStore.resetConfiguredHomeUrl(this);
        String configuredHomeUrl = SessionStore.getConfiguredHomeUrl(this);
        domainInput.setText(configuredHomeUrl);
        domainStatus.setText("Active domain: " + configuredHomeUrl);
        returnToKiosk();
    }

    private void applyUpdateSetting() {
        String rawValue = readInput(updateInput);
        if (rawValue.isEmpty()) {
            showUpdateError("Enter an update manifest URL.");
            return;
        }

        try {
            String normalized = SessionStore.setConfiguredUpdateUrl(this, rawValue);
            updateInput.setText(normalized);
            setUpdateStatus("Update manifest saved: " + normalized);
        } catch (IllegalArgumentException exception) {
            showUpdateError(exception.getMessage());
        }
    }

    private void resetUpdateSetting() {
        SessionStore.resetConfiguredUpdateUrl(this);
        String configuredUpdateUrl = SessionStore.getConfiguredUpdateUrl(this);
        updateInput.setText(configuredUpdateUrl);
        setUpdateStatus("Update manifest reset: " + configuredUpdateUrl);
    }

    private void checkUpdateAvailability() {
        String rawValue = readInput(updateInput);
        if (rawValue.isEmpty()) {
            showUpdateError("Enter an update manifest URL.");
            return;
        }

        setUpdateBusy(true);
        setUpdateStatus("Checking update manifest...");
        new Thread(() -> {
            try {
                ApkUpdateManager.UpdateCheckResult result = ApkUpdateManager.checkForUpdate(this, rawValue);
                String summary = "Installed " + result.installedVersionCode + " (" + safeText(result.installedVersionName) + ")"
                        + " • Remote " + result.manifest.versionCode + " (" + safeText(result.manifest.versionName) + ")"
                        + (result.updateAvailable ? " • Update available" : " • Up to date");
                if (result.manifest.sha256 != null && !result.manifest.sha256.trim().isEmpty()) {
                    summary += " • SHA-256 " + shortHash(result.manifest.sha256);
                }
                runOnUiThread(() -> setUpdateStatus(buildUpdateSummary(result)));
            } catch (Exception exception) {
                runOnUiThread(() -> showUpdateError(exception.getMessage() == null ? "Could not check APK version." : exception.getMessage()));
            } finally {
                runOnUiThread(() -> setUpdateBusy(false));
            }
        }).start();
    }

    private void forceUpdateInstall() {
        String rawValue = readInput(updateInput);
        if (rawValue.isEmpty()) {
            showUpdateError("Enter an update manifest URL.");
            return;
        }

        setUpdateBusy(true);
        setUpdateStatus("Downloading verified APK...");
        new Thread(() -> {
            try {
                ApkUpdateManager.UpdateCheckResult result = ApkUpdateManager.checkForUpdate(this, rawValue);
                File apkFile = ApkUpdateManager.downloadVerifiedApk(this, result.manifest);
                runOnUiThread(() -> {
                    try {
                        ApkUpdateManager.installApk(this, apkFile);
                        setUpdateStatus("Installer opened for " + safeText(result.manifest.versionName) + " (" + result.manifest.versionCode + ")");
                    } catch (IllegalStateException permissionError) {
                        setUpdateStatus("Enable install permission, then tap Force update again.");
                        Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName()));
                        startActivity(intent);
                    } catch (Exception exception) {
                        showUpdateError(exception.getMessage() == null ? "Could not open installer." : exception.getMessage());
                    }
                });
            } catch (Exception exception) {
                runOnUiThread(() -> showUpdateError(exception.getMessage() == null ? "Could not update APK." : exception.getMessage()));
            } finally {
                runOnUiThread(() -> setUpdateBusy(false));
            }
        }).start();
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

    private void applyScaleSetting() {
        String textZoomValue = readInput(textZoomInput);

        if (textZoomValue.isEmpty()) {
            showScaleError("Enter a text zoom value.");
            return;
        }

        try {
            int textZoom = Integer.parseInt(textZoomValue);
            SessionStore.setWebViewTextZoom(this, textZoom);
            textZoomInput.setText(String.valueOf(SessionStore.getWebViewTextZoom(this)));
            returnToKiosk();
        } catch (NumberFormatException exception) {
            showScaleError("Text zoom uses a whole number like 110 or 125.");
        }
    }

    private void resetScaleSetting() {
        SessionStore.setWebViewTextZoom(this, 100);
        textZoomInput.setText("100");
        returnToKiosk();
    }

    private void showScaleError(String message) {
        new AlertDialog.Builder(this)
                .setTitle("Invalid scale")
                .setMessage(message)
                .setPositiveButton("OK", (dialog, which) -> dialog.dismiss())
                .show();
    }

    private void showUpdateError(String message) {
        new AlertDialog.Builder(this)
                .setTitle("Update error")
                .setMessage(message)
                .setPositiveButton("OK", (dialog, which) -> dialog.dismiss())
                .show();
    }

    private void setUpdateStatus(String message) {
        if (updateStatus != null) {
            updateStatus.setTag(message);
            updateStatus.setText(message);
        }
    }

    private void setUpdateBusy(boolean busy) {
        updateSaveButton.setEnabled(!busy);
        updateResetButton.setEnabled(!busy);
        updateCheckButton.setEnabled(!busy);
        updateForceButton.setEnabled(!busy);
        updateInput.setEnabled(!busy);
    }

    private String safeText(String value) {
        return value == null || value.trim().isEmpty() ? "-" : value.trim();
    }

    private String buildUpdateSummary(ApkUpdateManager.UpdateCheckResult result) {
        StringBuilder summary = new StringBuilder();
        summary.append("Installed ")
                .append(result.installedVersionCode)
                .append(" (")
                .append(safeText(result.installedVersionName))
                .append(") | Remote ")
                .append(result.manifest.versionCode)
                .append(" (")
                .append(safeText(result.manifest.versionName))
                .append(")");

        summary.append(result.updateAvailable ? " | New version available" : " | Up to date");

        if (result.manifest.sha256 != null && !result.manifest.sha256.trim().isEmpty()) {
            String remoteHash = result.manifest.sha256.trim();
            summary.append(" | Remote hash ")
                    .append(remoteHash.length() <= 12 ? remoteHash : remoteHash.substring(0, 12) + "...");
        }

        if (result.installedSha256 != null && !result.installedSha256.trim().isEmpty()) {
            String installedHash = result.installedSha256.trim();
            summary.append(" | Installed hash ")
                    .append(installedHash.length() <= 12 ? installedHash : installedHash.substring(0, 12) + "...");
            summary.append(result.hashMatches ? " | Hash verified" : " | Hash differs");
        }

        return summary.toString();
    }

    private String shortHash(String hash) {
        String normalized = hash == null ? "" : hash.trim();
        if (normalized.length() <= 12) {
            return normalized;
        }
        return normalized.substring(0, 12) + "…";
    }

    private void showDomainError(String message) {
        new AlertDialog.Builder(this)
                .setTitle("Invalid domain")
                .setMessage(message)
                .setPositiveButton("OK", (dialog, which) -> dialog.dismiss())
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

    private EditText buildNumberInput(String hint) {
        EditText input = new EditText(this);
        input.setHint(hint);
        input.setHintTextColor(0xFF7A7A7A);
        input.setTextColor(0xFFFFFFFF);
        input.setInputType(InputType.TYPE_CLASS_NUMBER);
        return input;
    }

    private EditText buildTextInput(String hint) {
        EditText input = new EditText(this);
        input.setHint(hint);
        input.setHintTextColor(0xFF7A7A7A);
        input.setTextColor(0xFFFFFFFF);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setSingleLine(true);
        return input;
    }

    private String readInput(EditText input) {
        return input.getText() == null ? "" : input.getText().toString().trim();
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
