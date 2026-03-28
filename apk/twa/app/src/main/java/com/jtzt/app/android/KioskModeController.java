package com.jtzt.app.android;

import android.app.Activity;
import android.content.Context;
import android.content.ComponentName;
import android.app.admin.DevicePolicyManager;
import android.os.Build;
import android.os.PowerManager;
import android.os.UserManager;

import com.jtzt.app.HomeRoleHelper;
import com.jtzt.app.KioskDeviceAdminReceiver;

public final class KioskModeController {
    private static PowerManager.WakeLock wakeLock;

    private KioskModeController() {
    }

    public static void enter(Activity activity) {
        if (activity == null) {
            return;
        }

        if (!shouldEnforce(activity)) {
            exit(activity);
            return;
        }

        DevicePolicyManager devicePolicyManager = activity.getSystemService(DevicePolicyManager.class);
        if (devicePolicyManager != null) {
            applyEnterprisePolicies(activity, devicePolicyManager);
        }

        AndroidUiController.applyFullscreen(activity);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            activity.setTurnScreenOn(true);
            activity.setShowWhenLocked(true);
        }

        if (devicePolicyManager != null && devicePolicyManager.isLockTaskPermitted(activity.getPackageName())) {
            tryStartLockTask(activity);
        }

        acquireWakeLock(activity);
    }

    public static void exit(Activity activity) {
        releaseWakeLock();
        if (activity == null) {
            return;
        }

        try {
            activity.stopLockTask();
        } catch (Throwable ignored) {
        }
    }

    private static void tryStartLockTask(Activity activity) {
        try {
            activity.startLockTask();
        } catch (Throwable ignored) {
        }
    }

    private static void applyEnterprisePolicies(Activity activity, DevicePolicyManager devicePolicyManager) {
        applyEnterprisePolicies(activity.getApplicationContext(), devicePolicyManager);
    }

    public static void applyEnterprisePolicies(Context context, DevicePolicyManager devicePolicyManager) {
        if (context == null || devicePolicyManager == null) {
            return;
        }

        ComponentName admin = new ComponentName(context, KioskDeviceAdminReceiver.class);
        try {
            if (devicePolicyManager.isDeviceOwnerApp(context.getPackageName())) {
                devicePolicyManager.setLockTaskPackages(admin, new String[] { context.getPackageName() });
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    devicePolicyManager.setLockTaskFeatures(admin, DevicePolicyManager.LOCK_TASK_FEATURE_NONE);
                    devicePolicyManager.setStatusBarDisabled(admin, true);
                    devicePolicyManager.setKeyguardDisabled(admin, true);
                }
                devicePolicyManager.setScreenCaptureDisabled(admin, true);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    devicePolicyManager.addUserRestriction(admin, UserManager.DISALLOW_CREATE_WINDOWS);
                    devicePolicyManager.addUserRestriction(admin, UserManager.DISALLOW_SAFE_BOOT);
                    devicePolicyManager.addUserRestriction(admin, UserManager.DISALLOW_FACTORY_RESET);
                    devicePolicyManager.addUserRestriction(admin, UserManager.DISALLOW_ADJUST_VOLUME);
                }
            }
        } catch (Throwable ignored) {
        }
    }

    private static void acquireWakeLock(Activity activity) {
        releaseWakeLock();
        Context context = activity.getApplicationContext();
        PowerManager powerManager = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        if (powerManager == null) {
            return;
        }

        wakeLock = powerManager.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP,
                "Jtzt:KioskWakeLock"
        );
        wakeLock.setReferenceCounted(false);
        try {
            wakeLock.acquire();
        } catch (Throwable ignored) {
            wakeLock = null;
        }
    }

    private static void releaseWakeLock() {
        if (wakeLock != null) {
            try {
                if (wakeLock.isHeld()) {
                    wakeLock.release();
                }
            } catch (Throwable ignored) {
            } finally {
                wakeLock = null;
            }
        }
    }

    public static boolean shouldEnforce(Activity activity) {
        if (activity == null) {
            return false;
        }

        return HomeRoleHelper.isDefaultHome(activity);
    }
}
