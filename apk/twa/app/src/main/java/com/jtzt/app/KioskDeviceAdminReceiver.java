package com.jtzt.app;

import android.app.admin.DevicePolicyManager;
import android.content.Context;
import android.content.Intent;
import android.app.admin.DeviceAdminReceiver;

import com.jtzt.app.android.KioskModeController;

public class KioskDeviceAdminReceiver extends DeviceAdminReceiver {
    @Override
    public void onEnabled(Context context, Intent intent) {
        applyPolicies(context);
    }

    @Override
    public void onLockTaskModeEntering(Context context, Intent intent, String pkg) {
        applyPolicies(context);
    }

    @Override
    public void onLockTaskModeExiting(Context context, Intent intent) {
        applyPolicies(context);
    }

    private void applyPolicies(Context context) {
        if (context == null) {
            return;
        }

        DevicePolicyManager devicePolicyManager = context.getSystemService(DevicePolicyManager.class);
        if (devicePolicyManager == null) {
            return;
        }

        KioskModeController.applyEnterprisePolicies(context, devicePolicyManager);
    }
}
