package com.jtzt.app;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;

import androidx.core.content.FileProvider;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URL;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Locale;

public final class ApkUpdateManager {
    private static final int CONNECT_TIMEOUT_MS = 15_000;
    private static final int READ_TIMEOUT_MS = 20_000;
    private static final String APK_MIME_TYPE = "application/vnd.android.package-archive";
    private static final String UPDATE_DIR = "apk_updates";
    private static final String UPDATE_FILE_NAME = "jtzt-update.apk";
    private static final String DEFAULT_UPDATE_URL = "https://app.jtzt.com/jtzt.manifest";

    public static final class UpdateManifest {
        public final long versionCode;
        public final String versionName;
        public final String sha256;
        public final String apkUrl;

        public UpdateManifest(long versionCode, String versionName, String sha256, String apkUrl) {
            this.versionCode = versionCode;
            this.versionName = versionName;
            this.sha256 = sha256;
            this.apkUrl = apkUrl;
        }
    }

    public static final class UpdateCheckResult {
        public final long installedVersionCode;
        public final String installedVersionName;
        public final String installedSha256;
        public final UpdateManifest manifest;
        public final boolean updateAvailable;
        public final boolean hashMatches;
        public final String manifestUrl;

        public UpdateCheckResult(
                long installedVersionCode,
                String installedVersionName,
                String installedSha256,
                UpdateManifest manifest,
                boolean updateAvailable,
                boolean hashMatches,
                String manifestUrl
        ) {
            this.installedVersionCode = installedVersionCode;
            this.installedVersionName = installedVersionName;
            this.installedSha256 = installedSha256;
            this.manifest = manifest;
            this.updateAvailable = updateAvailable;
            this.hashMatches = hashMatches;
            this.manifestUrl = manifestUrl;
        }
    }

    private ApkUpdateManager() {
    }

    public static String normalizeUpdateUrl(String rawUpdateUrl) {
        if (rawUpdateUrl == null) {
            return DEFAULT_UPDATE_URL;
        }

        String candidate = rawUpdateUrl.trim();
        if (candidate.isEmpty()) {
            return DEFAULT_UPDATE_URL;
        }

        if (!candidate.contains("://")) {
            candidate = "https://" + candidate;
        }

        try {
            URI uri = new URI(candidate);
            String scheme = uri.getScheme();
            String host = uri.getHost();
            if (scheme == null || host == null || host.trim().isEmpty()) {
                throw new IllegalArgumentException("Enter a valid APK URL.");
            }

            String normalizedScheme = scheme.toLowerCase(Locale.US);
            if (!"https".equals(normalizedScheme) && !"http".equals(normalizedScheme)) {
                throw new IllegalArgumentException("Only http and https URLs are supported.");
            }

            URI normalizedUri = new URI(
                    normalizedScheme,
                    null,
                    host.toLowerCase(Locale.US),
                    uri.getPort(),
                    uri.getPath() == null || uri.getPath().trim().isEmpty() ? "/jtzt.manifest" : uri.getPath(),
                    uri.getQuery(),
                    uri.getFragment()
            );
            return normalizedUri.toString();
        } catch (URISyntaxException exception) {
            throw new IllegalArgumentException("Enter a valid APK URL.");
        }
    }

    public static String buildManifestUrl(String updateUrl) {
        String normalized = normalizeUpdateUrl(updateUrl);
        String lower = normalized.toLowerCase(Locale.US);
        int queryIndex = lower.indexOf('?');
        int fragmentIndex = lower.indexOf('#');
        int cutIndex = queryIndex >= 0 ? queryIndex : lower.length();
        if (fragmentIndex >= 0 && fragmentIndex < cutIndex) {
            cutIndex = fragmentIndex;
        }
        String pathPart = normalized.substring(0, cutIndex);
        String suffixPart = normalized.substring(cutIndex);
        String pathLower = pathPart.toLowerCase(Locale.US);
        if (pathLower.endsWith(".manifest") || pathLower.endsWith(".json")) {
            return normalized;
        }
        if (pathLower.endsWith(".apk")) {
            return pathPart.substring(0, pathPart.length() - 4) + ".manifest" + suffixPart;
        }
        return pathPart + ".manifest" + suffixPart;
    }

    public static UpdateCheckResult checkForUpdate(Activity activity, String updateUrl) throws IOException {
        long installedVersionCode = getInstalledVersionCode(activity);
        String installedVersionName = getInstalledVersionName(activity);
        String installedSha256 = getInstalledApkSha256(activity);
        String manifestUrl = buildManifestUrl(updateUrl);
        UpdateManifest manifest = fetchManifest(manifestUrl);
        boolean updateAvailable = manifest.versionCode > installedVersionCode;
        boolean hashMatches = installedSha256 != null
                && !installedSha256.trim().isEmpty()
                && manifest.sha256 != null
                && !manifest.sha256.trim().isEmpty()
                && installedSha256.trim().equalsIgnoreCase(manifest.sha256.trim());
        return new UpdateCheckResult(
                installedVersionCode,
                installedVersionName,
                installedSha256,
                manifest,
                updateAvailable,
                hashMatches,
                manifestUrl
        );
    }

    public static File downloadVerifiedApk(Activity activity, UpdateManifest manifest) throws IOException {
        if (manifest.sha256 == null || manifest.sha256.trim().isEmpty()) {
            throw new IllegalArgumentException("Update manifest must include sha256.");
        }

        File directory = new File(activity.getCacheDir(), UPDATE_DIR);
        if (!directory.exists() && !directory.mkdirs()) {
            throw new IOException("Could not create update cache directory");
        }

        File target = new File(directory, UPDATE_FILE_NAME);
        downloadFile(resolveApkUrl(manifest), target);

        String downloadedHash = hashFileSha256(target);
        if (!downloadedHash.equalsIgnoreCase(manifest.sha256.trim())) {
            target.delete();
            throw new IOException("Downloaded APK hash does not match the manifest");
        }

        return target;
    }

    public static void installApk(Activity activity, File apkFile) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !activity.getPackageManager().canRequestPackageInstalls()) {
            throw new IllegalStateException("Install permission required");
        }

        Uri contentUri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".fileprovider", apkFile);
        Intent installIntent = new Intent(Intent.ACTION_VIEW);
        installIntent.setDataAndType(contentUri, APK_MIME_TYPE);
        installIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        installIntent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP);
        activity.startActivity(installIntent);
    }

    public static long getInstalledVersionCode(Activity activity) {
        try {
            PackageInfo info = activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                return info.getLongVersionCode();
            }
            return info.versionCode;
        } catch (PackageManager.NameNotFoundException exception) {
            return 0L;
        }
    }

    public static String getInstalledVersionName(Activity activity) {
        try {
            PackageInfo info = activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0);
            return info.versionName == null ? "" : info.versionName;
        } catch (PackageManager.NameNotFoundException exception) {
            return "";
        }
    }

    public static String getInstalledApkSha256(Activity activity) {
        try {
            String sourceDir = activity.getApplicationInfo().sourceDir;
            if (sourceDir == null || sourceDir.trim().isEmpty()) {
                return "";
            }

            return hashFileSha256(new File(sourceDir));
        } catch (Exception exception) {
            return "";
        }
    }

    private static UpdateManifest fetchManifest(String manifestUrl) throws IOException {
        HttpURLConnection connection = openConnection(manifestUrl);
        try {
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) {
                throw new IOException("Update manifest request failed with HTTP " + status);
            }

            String jsonText = readStream(connection.getInputStream());
            JSONObject json = new JSONObject(jsonText);
            if (!json.has("versionCode")) {
                throw new IllegalArgumentException("Update manifest is missing versionCode.");
            }

            long versionCode = json.getLong("versionCode");
            String versionName = json.optString("versionName", "");
            String sha256 = json.optString("sha256", "");
            String apkUrl = json.optString("apkUrl", json.optString("downloadUrl", ""));
            if (apkUrl == null || apkUrl.trim().isEmpty()) {
                apkUrl = buildFallbackApkUrl(manifestUrl);
            }
            return new UpdateManifest(versionCode, versionName, sha256, normalizeUpdateUrl(apkUrl));
        } catch (Exception exception) {
            throw new IOException("Could not parse update manifest at " + manifestUrl, exception);
        } finally {
            connection.disconnect();
        }
    }

    private static String resolveApkUrl(UpdateManifest manifest) {
        return normalizeUpdateUrl(manifest.apkUrl);
    }

    private static String buildFallbackApkUrl(String manifestUrl) {
        try {
            URI uri = new URI(manifestUrl);
            String path = uri.getPath();
            if (path == null || path.trim().isEmpty()) {
                path = "/jtzt.apk";
            } else if (path.endsWith(".manifest")) {
                path = path.substring(0, path.length() - ".manifest".length()) + ".apk";
            } else if (path.endsWith(".json")) {
                path = path.substring(0, path.length() - ".json".length()) + ".apk";
            } else if (!path.endsWith(".apk")) {
                path = path.endsWith("/") ? path + "jtzt.apk" : path + ".apk";
            }

            URI apkUri = new URI(
                    uri.getScheme(),
                    null,
                    uri.getHost(),
                    uri.getPort(),
                    path,
                    null,
                    null
            );
            return apkUri.toString();
        } catch (URISyntaxException exception) {
            return DEFAULT_UPDATE_URL.replace(".manifest", ".apk");
        }
    }

    private static void downloadFile(String url, File target) throws IOException {
        HttpURLConnection connection = openConnection(url);
        try {
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) {
                throw new IOException("APK download failed with HTTP " + status);
            }

            try (InputStream inputStream = new BufferedInputStream(connection.getInputStream());
                 BufferedOutputStream outputStream = new BufferedOutputStream(new FileOutputStream(target))) {
                byte[] buffer = new byte[16 * 1024];
                int read;
                while ((read = inputStream.read(buffer)) != -1) {
                    outputStream.write(buffer, 0, read);
                }
                outputStream.flush();
            }
        } finally {
            connection.disconnect();
        }
    }

    private static String hashFileSha256(File file) throws IOException {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            try (InputStream inputStream = new FileInputStream(file)) {
                byte[] buffer = new byte[16 * 1024];
                int read;
                while ((read = inputStream.read(buffer)) != -1) {
                    digest.update(buffer, 0, read);
                }
            }

            StringBuilder hash = new StringBuilder();
            for (byte value : digest.digest()) {
                hash.append(String.format(Locale.US, "%02x", value));
            }
            return hash.toString();
        } catch (NoSuchAlgorithmException exception) {
            throw new IOException("SHA-256 not available", exception);
        }
    }

    private static HttpURLConnection openConnection(String url) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setInstanceFollowRedirects(true);
        connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
        connection.setReadTimeout(READ_TIMEOUT_MS);
        connection.setUseCaches(false);
        connection.setRequestProperty("Accept", "application/json, application/octet-stream, */*;q=0.1");
        return connection;
    }

    private static String readStream(InputStream inputStream) throws IOException {
        try (InputStream input = new BufferedInputStream(inputStream);
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
            return output.toString("UTF-8");
        }
    }
}
