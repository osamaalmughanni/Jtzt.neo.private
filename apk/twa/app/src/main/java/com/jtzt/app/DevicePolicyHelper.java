package com.jtzt.app;

import android.app.Activity;
import android.app.ActivityManager;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.provider.Settings;

public final class DevicePolicyHelper {
    private static final int REQUEST_DEVICE_ADMIN = 7101;

    private DevicePolicyHelper() {
    }

    public static boolean isDeviceAdminActive(Context context) {
        DevicePolicyManager manager = getDevicePolicyManager(context);
        return manager != null && manager.isAdminActive(getAdminComponent(context));
    }

    public static boolean isDeviceOwner(Context context) {
        DevicePolicyManager manager = getDevicePolicyManager(context);
        return manager != null && manager.isDeviceOwnerApp(context.getPackageName());
    }

    public static boolean isLockTaskPermitted(Activity activity) {
        DevicePolicyManager manager = getDevicePolicyManager(activity);
        return manager != null && manager.isLockTaskPermitted(activity.getPackageName());
    }

    public static boolean isLockTaskActive(Activity activity) {
        if (activity == null) {
            return false;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            ActivityManager manager = activity.getSystemService(ActivityManager.class);
            return manager != null && manager.getLockTaskModeState() != ActivityManager.LOCK_TASK_MODE_NONE;
        }

        return false;
    }

    public static void requestDeviceAdmin(Activity activity) {
        if (activity == null || isDeviceAdminActive(activity)) {
            return;
        }

        Intent intent = new Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN);
        intent.putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, getAdminComponent(activity));
        intent.putExtra(
                DevicePolicyManager.EXTRA_ADD_EXPLANATION,
                "Device admin lets Jtzt enforce the strongest runtime restrictions Android allows."
        );
        activity.startActivityForResult(intent, REQUEST_DEVICE_ADMIN);
    }

    public static void openDeviceAdminSettings(Activity activity) {
        if (activity == null) {
            return;
        }

        Intent intent = new Intent(Settings.ACTION_SECURITY_SETTINGS);
        activity.startActivity(intent);
    }

    private static DevicePolicyManager getDevicePolicyManager(Context context) {
        if (context == null) {
            return null;
        }

        return context.getSystemService(DevicePolicyManager.class);
    }

    private static ComponentName getAdminComponent(Context context) {
        return new ComponentName(context, KioskDeviceAdminReceiver.class);
    }
}
