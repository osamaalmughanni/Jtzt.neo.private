package com.jtzt.app;

import android.app.Activity;
import android.app.role.RoleManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.os.Build;
import android.provider.Settings;

import java.util.ArrayList;
import java.util.List;

public final class HomeRoleHelper {
    private static final int REQUEST_HOME_ROLE = 7001;

    private HomeRoleHelper() {
    }

    public static boolean isDefaultHome(Activity activity) {
        if (activity == null) {
            return false;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            RoleManager roleManager = activity.getSystemService(RoleManager.class);
            if (roleManager != null && roleManager.isRoleAvailable(RoleManager.ROLE_HOME)) {
                return roleManager.isRoleHeld(RoleManager.ROLE_HOME);
            }
        }

        Intent homeIntent = new Intent(Intent.ACTION_MAIN);
        homeIntent.addCategory(Intent.CATEGORY_HOME);
        PackageManager packageManager = activity.getPackageManager();
        ResolveInfo resolved = packageManager.resolveActivity(homeIntent, PackageManager.MATCH_DEFAULT_ONLY);
        if (resolved == null || resolved.activityInfo == null) {
            return false;
        }

        List<ResolveInfo> homeCandidates = packageManager.queryIntentActivities(homeIntent, PackageManager.MATCH_DEFAULT_ONLY);
        return homeCandidates.size() == 1 && activity.getPackageName().equals(resolved.activityInfo.packageName);
    }

    public static void requestDefaultHome(Activity activity) {
        if (activity == null || isDefaultHome(activity)) {
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            RoleManager roleManager = activity.getSystemService(RoleManager.class);
            if (roleManager != null && roleManager.isRoleAvailable(RoleManager.ROLE_HOME) && !roleManager.isRoleHeld(RoleManager.ROLE_HOME)) {
                activity.startActivityForResult(roleManager.createRequestRoleIntent(RoleManager.ROLE_HOME), REQUEST_HOME_ROLE);
                return;
            }
        }

        activity.startActivity(new Intent(Settings.ACTION_HOME_SETTINGS));
    }

    public static void openLauncherSettings(Activity activity) {
        if (activity == null) {
            return;
        }

        activity.startActivity(new Intent(Settings.ACTION_HOME_SETTINGS));
    }
}
