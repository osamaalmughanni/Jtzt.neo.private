from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


def read_json(path: Path) -> dict:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def resolve_tool(path: Path, name: str) -> Path:
    if not path.exists():
        raise RuntimeError(f"Missing required tool: {name} at {path}")
    return path


def run_command(command: list[str], *, cwd: Path | None = None, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        command,
        cwd=str(cwd) if cwd else None,
        env=env,
        text=True,
        capture_output=True,
        encoding="utf-8",
        errors="replace",
    )
    output = f"{result.stdout}{result.stderr}"
    if output:
        print(output, end="")
    return result


def get_version_metadata(manifest_path: Path) -> tuple[int, str]:
    now = datetime.now()
    candidate_code = int(f"{now.year % 100:02d}{now.timetuple().tm_yday:03d}{now.hour:02d}{now.minute:02d}")
    version_name = now.strftime("%Y.%m.%d-%H%M")
    existing_code = 0

    if manifest_path.exists():
        try:
            manifest = read_json(manifest_path)
            existing_code = int(manifest.get("appVersionCode") or 0)
        except Exception:
            existing_code = 0

    if candidate_code <= existing_code:
        candidate_code = existing_code + 1

    return candidate_code, version_name


def hash_file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run_gradle_release_build(gradlew: Path, project_dir: Path, gradle_home: Path, env: dict[str, str]) -> None:
    result = run_command([str(gradlew), "assembleRelease", "--no-daemon"], cwd=project_dir, env=env)
    if result.returncode == 0:
        return

    combined_output = f"{result.stdout}{result.stderr}"
    if "Could not read workspace metadata" not in combined_output:
        raise RuntimeError("Gradle release build failed.")

    shutil.rmtree(gradle_home / "caches", ignore_errors=True)
    ensure_dir(gradle_home / "caches")

    retry = run_command([str(gradlew), "assembleRelease", "--no-daemon"], cwd=project_dir, env=env)
    if retry.returncode != 0:
        raise RuntimeError("Gradle release build failed after cache reset.")


def ensure_keystore(
    keytool: Path,
    keystore_path: Path,
    keystore_password: str,
    key_alias: str,
    key_password: str,
    env: dict[str, str],
) -> None:
    if keystore_path.exists():
        return

    ensure_dir(keystore_path.parent)
    generated = run_command(
        [
            str(keytool),
            "-genkeypair",
            "-storetype",
            "PKCS12",
            "-keystore",
            str(keystore_path),
            "-storepass",
            keystore_password,
            "-keypass",
            key_password,
            "-alias",
            key_alias,
            "-keyalg",
            "RSA",
            "-keysize",
            "2048",
            "-validity",
            "3650",
            "-dname",
            "CN=Jtzt, OU=Android, O=Jtzt, L=Vienna, ST=Vienna, C=AT",
        ],
        env=env,
    )
    if generated.returncode != 0:
        raise RuntimeError("Failed to generate Android keystore.")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--recreate-project", action="store_true")
    parser.add_argument("--skip-build", action="store_true")
    parser.add_argument("--release-name", default="Jtzt.apk")
    args = parser.parse_args()

    script_dir = Path(__file__).resolve().parent
    repo_root = script_dir.parent
    config_path = script_dir / "config" / "build-settings.json"
    project_dir = script_dir / "twa"
    generate_script = script_dir / "scripts" / "generate-twa.cjs"

    config = read_json(config_path)
    version_code, version_name = get_version_metadata(project_dir / "twa-manifest.json")

    release_dir = script_dir / str(config.get("releaseOutputDir") or "release")
    release_name = args.release_name or str(config.get("releaseFileName") or "Jtzt.apk")
    release_apk = release_dir / release_name

    java_home_value = os.environ.get("JAVA_HOME")
    if java_home_value and (Path(java_home_value) / "bin" / "java.exe").exists():
        java_home = Path(java_home_value)
    else:
        java_home = Path(str(config.get("javaHome") or ""))

    sdk_root_value = os.environ.get("ANDROID_SDK_ROOT")
    if sdk_root_value and (Path(sdk_root_value) / "cmdline-tools" / "latest" / "bin" / "sdkmanager.bat").exists():
        sdk_root = Path(sdk_root_value)
    else:
        sdk_root = Path(str(config.get("androidSdkRoot") or ""))

    build_tools_version = str(config.get("buildToolsVersion") or "35.0.0")

    if not java_home or not (java_home / "bin" / "java.exe").exists():
        raise RuntimeError(f"JAVA_HOME is not set and no fallback was found in {config_path}.")
    if not sdk_root or not (sdk_root / "cmdline-tools" / "latest" / "bin" / "sdkmanager.bat").exists():
        raise RuntimeError(f"ANDROID_SDK_ROOT is not set and no fallback was found in {config_path}.")

    java_bin = resolve_tool(java_home / "bin" / "java.exe", "java")
    keytool = resolve_tool(java_home / "bin" / "keytool.exe", "keytool")
    node_exe = shutil.which("node")
    if not node_exe:
        raise RuntimeError("Missing required tool: node")
    gradlew = resolve_tool(project_dir / "gradlew.bat", "Gradle wrapper")
    zipalign = resolve_tool(sdk_root / "build-tools" / build_tools_version / "zipalign.exe", "zipalign")
    apksigner = resolve_tool(sdk_root / "build-tools" / build_tools_version / "apksigner.bat", "apksigner")

    ensure_dir(release_dir)
    local_home = script_dir / ".home"
    android_home = local_home / ".android"
    gradle_home = local_home / ".gradle"
    ensure_dir(local_home)
    ensure_dir(android_home)
    ensure_dir(gradle_home)

    base_env = os.environ.copy()
    base_env["JAVA_HOME"] = str(java_home)
    base_env["ANDROID_HOME"] = str(sdk_root)
    base_env["ANDROID_SDK_ROOT"] = str(sdk_root)
    base_env["ANDROID_SDK_HOME"] = str(local_home)
    base_env["ANDROID_USER_HOME"] = str(android_home)
    base_env["GRADLE_USER_HOME"] = str(gradle_home)
    base_env["PATH"] = os.pathsep.join([
        str(java_bin.parent),
        str(sdk_root / "cmdline-tools" / "latest" / "bin"),
        str(sdk_root / "platform-tools"),
        base_env.get("PATH", ""),
    ])

    print("Rendering Android assets from the app logo...")
    render = run_command(
        [
            "powershell",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(script_dir / "scripts" / "render-android-assets.ps1"),
        ],
        cwd=repo_root,
        env=base_env,
    )
    if render.returncode != 0:
        raise RuntimeError("Android asset rendering failed.")

    required_platform = "android-35"
    required_platform_path = sdk_root / "platforms" / required_platform
    required_build_tools_path = sdk_root / "build-tools" / build_tools_version
    if not required_build_tools_path.exists():
        raise RuntimeError(f"Missing Android build-tools at {required_build_tools_path}. Install build-tools {build_tools_version} in {sdk_root}.")
    if not required_platform_path.exists():
        raise RuntimeError(f"Missing Android platform at {required_platform_path}. Install {required_platform} in {sdk_root}.")

    if args.recreate_project or not project_dir.exists():
        print("Generating Bubblewrap project...")
        generated = run_command([node_exe, str(generate_script)], cwd=repo_root, env=base_env)
        if generated.returncode != 0:
            raise RuntimeError("Bubblewrap generation failed.")

    print("Syncing production Android settings...")
    base_env["JTZT_ANDROID_VERSION_CODE"] = str(version_code)
    base_env["JTZT_ANDROID_VERSION_NAME"] = version_name
    synced = run_command([node_exe, str(generate_script), "--sync-only"], cwd=repo_root, env=base_env)
    if synced.returncode != 0:
        raise RuntimeError("Bubblewrap production sync failed.")

    if not args.skip_build:
        build_env = base_env.copy()
        build_env["HOME"] = str(local_home)
        build_env["USERPROFILE"] = str(local_home)
        build_env["JAVA_TOOL_OPTIONS"] = (
            f"-Duser.home={local_home} "
            f"-DANDROID_USER_HOME={android_home} "
            f"-DANDROID_SDK_HOME={local_home} "
            f"-DANDROID_PREFS_ROOT={local_home}"
        )

        print("Building release APK...")
        run_gradle_release_build(gradlew, project_dir, gradle_home, build_env)

    signed_apk = project_dir / "app" / "build" / "outputs" / "apk" / "release" / "app-release.apk"
    unsigned_apk = project_dir / "app" / "build" / "outputs" / "apk" / "release" / "app-release-unsigned.apk"

    if not signed_apk.exists() and unsigned_apk.exists():
        aligned_apk = project_dir / "app" / "build" / "outputs" / "apk" / "release" / "app-release-aligned.apk"
        if aligned_apk.exists():
            aligned_apk.unlink()
        if signed_apk.exists():
            signed_apk.unlink()

        aligned = run_command([str(zipalign), "-p", "4", str(unsigned_apk), str(aligned_apk)], cwd=repo_root, env=base_env)
        if aligned.returncode != 0:
            raise RuntimeError("zipalign failed.")

        keystore_path = project_dir / "android.keystore"
        keystore_password = os.environ.get("BUBBLEWRAP_KEYSTORE_PASSWORD") or str(config.get("keystorePassword") or "changeit123")
        key_password = os.environ.get("BUBBLEWRAP_KEY_PASSWORD") or str(config.get("keyPassword") or keystore_password)
        key_alias = str(config.get("keystoreAlias") or "android")
        ensure_keystore(keytool, keystore_path, keystore_password, key_alias, key_password, base_env)

        signed = run_command(
            [
                str(apksigner),
                "sign",
                "--ks",
                str(keystore_path),
                "--ks-key-alias",
                key_alias,
                "--ks-pass",
                f"pass:{keystore_password}",
                "--key-pass",
                f"pass:{key_password}",
                "--out",
                str(signed_apk),
                str(aligned_apk),
            ],
            cwd=repo_root,
            env=base_env,
        )
        if signed.returncode != 0:
            raise RuntimeError("apksigner failed.")

    if not signed_apk.exists():
        raise RuntimeError(f"Release APK was not produced at {signed_apk}")

    shutil.copy2(signed_apk, release_apk)
    frontend_public_dir = repo_root / "frontend" / "public"
    ensure_dir(frontend_public_dir)
    shutil.copy2(signed_apk, frontend_public_dir / "jtzt.apk")

    apk_sha256 = hash_file_sha256(signed_apk)
    update_manifest = {
        "versionCode": version_code,
        "versionName": version_name,
        "sha256": apk_sha256,
        "apkUrl": "https://app.jtzt.com/jtzt.apk",
        "downloadUrl": "https://app.jtzt.com/jtzt.apk",
        "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
    }
    update_manifest_json = json.dumps(update_manifest, indent=2) + "\n"
    (release_dir / "jtzt.manifest").write_text(update_manifest_json, encoding="utf-8")
    (frontend_public_dir / "jtzt.manifest").write_text(update_manifest_json, encoding="utf-8")

    print(f"Release APK ready: {release_apk}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(exc, file=sys.stderr)
        raise SystemExit(1)
