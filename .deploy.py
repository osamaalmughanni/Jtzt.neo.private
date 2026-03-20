#!/usr/bin/env python3
"""
Cloudflare deployment helper for Jtzt using SQLite-backed Durable Objects.
"""

from __future__ import annotations

import argparse
import json
import os
import secrets
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parent
ENV_FILE = ROOT / ".env"
CLOUDFLARE_DEV_VARS_FILE = ROOT / "cloudflare/.dev.vars"

DEFAULT_WRANGLER_CONFIG = "cloudflare/wrangler.jsonc"
DEFAULT_WORKER_ENTRY = "cloudflare/worker/index.ts"
DEFAULT_ASSETS_DIR = "dist/frontend"
DEFAULT_SYSTEM_DO_BINDING = "SYSTEM_DO"
DEFAULT_SYSTEM_DO_CLASS = "SystemDurableObject"
DEFAULT_COMPANY_DO_BINDING = "COMPANY_DO"
DEFAULT_COMPANY_DO_CLASS = "CompanyDurableObject"
DEFAULT_DO_MIGRATION_TAG = "v1"

NON_RUNTIME_ENV_KEYS = {
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_CUSTOM_DOMAIN",
    "CLOUDFLARE_WRANGLER_CONFIG",
    "CLOUDFLARE_WORKER_ENTRY",
    "CLOUDFLARE_ASSETS_DIR",
    "CLOUDFLARE_ASSETS_NOT_FOUND_HANDLING",
    "CLOUDFLARE_WORKER_NAME",
    "CLOUDFLARE_COMPATIBILITY_DATE",
    "CLOUDFLARE_D1_BINDING",
    "CLOUDFLARE_D1_DATABASE_NAME",
    "CLOUDFLARE_D1_DATABASE_ID",
    "CLOUDFLARE_MIGRATIONS_DIR",
    "CLOUDFLARE_SYSTEM_DO_BINDING",
    "CLOUDFLARE_SYSTEM_DO_CLASS",
    "CLOUDFLARE_COMPANY_DO_BINDING",
    "CLOUDFLARE_COMPANY_DO_CLASS",
    "CLOUDFLARE_DO_MIGRATION_TAG",
    "NODE_SQLITE_PATH",
    "NODE_SYSTEM_SQLITE_PATH",
    "NODE_COMPANY_SQLITE_DIR",
}
NON_SECRET_RUNTIME_KEYS = {
    "APP_ENV",
    "APP_VERSION",
    "SESSION_TTL_HOURS",
}
SECRET_NAME_MARKERS = ("SECRET", "TOKEN", "PASSWORD", "PASSPHRASE")

ENV_OPTIONAL_DEFAULTS = {
    "APP_ENV": "production",
    "APP_VERSION": "dev",
    "SESSION_TTL_HOURS": "12",
    "ADMIN_ACCESS_TOKEN": "",
    "ADMIN_BOOTSTRAP_TOKEN": "",
    "CLOUDFLARE_API_TOKEN": "",
    "CLOUDFLARE_ACCOUNT_ID": "",
    "CLOUDFLARE_CUSTOM_DOMAIN": "",
    "CLOUDFLARE_WRANGLER_CONFIG": DEFAULT_WRANGLER_CONFIG,
    "CLOUDFLARE_WORKER_ENTRY": DEFAULT_WORKER_ENTRY,
    "CLOUDFLARE_ASSETS_DIR": DEFAULT_ASSETS_DIR,
    "CLOUDFLARE_ASSETS_NOT_FOUND_HANDLING": "single-page-application",
    "CLOUDFLARE_SYSTEM_DO_BINDING": DEFAULT_SYSTEM_DO_BINDING,
    "CLOUDFLARE_SYSTEM_DO_CLASS": DEFAULT_SYSTEM_DO_CLASS,
    "CLOUDFLARE_COMPANY_DO_BINDING": DEFAULT_COMPANY_DO_BINDING,
    "CLOUDFLARE_COMPANY_DO_CLASS": DEFAULT_COMPANY_DO_CLASS,
    "CLOUDFLARE_DO_MIGRATION_TAG": DEFAULT_DO_MIGRATION_TAG,
    "NODE_SYSTEM_SQLITE_PATH": "data/system.db",
    "NODE_COMPANY_SQLITE_DIR": "data/companies",
}

COMMAND_REQUIRED_KEYS = {
    "doctor": [
        "CLOUDFLARE_API_TOKEN",
        "CLOUDFLARE_ACCOUNT_ID",
        "CLOUDFLARE_WORKER_NAME",
        "CLOUDFLARE_COMPATIBILITY_DATE",
        "JWT_SECRET",
    ],
    "prepare-dev": [
        "CLOUDFLARE_API_TOKEN",
        "CLOUDFLARE_ACCOUNT_ID",
        "CLOUDFLARE_WORKER_NAME",
        "CLOUDFLARE_COMPATIBILITY_DATE",
        "JWT_SECRET",
        "ADMIN_ACCESS_TOKEN",
    ],
    "write-config": [
        "CLOUDFLARE_API_TOKEN",
        "CLOUDFLARE_ACCOUNT_ID",
        "CLOUDFLARE_WORKER_NAME",
        "CLOUDFLARE_COMPATIBILITY_DATE",
    ],
    "typecheck": ["JWT_SECRET"],
    "build": [],
    "set-secret": [
        "CLOUDFLARE_API_TOKEN",
        "CLOUDFLARE_ACCOUNT_ID",
        "CLOUDFLARE_WORKER_NAME",
        "CLOUDFLARE_COMPATIBILITY_DATE",
        "JWT_SECRET",
        "ADMIN_ACCESS_TOKEN",
    ],
    "deploy": [
        "CLOUDFLARE_API_TOKEN",
        "CLOUDFLARE_ACCOUNT_ID",
        "CLOUDFLARE_WORKER_NAME",
        "CLOUDFLARE_COMPATIBILITY_DATE",
    ],
    "full": [
        "CLOUDFLARE_API_TOKEN",
        "CLOUDFLARE_ACCOUNT_ID",
        "CLOUDFLARE_WORKER_NAME",
        "CLOUDFLARE_COMPATIBILITY_DATE",
        "JWT_SECRET",
        "ADMIN_ACCESS_TOKEN",
    ],
}


def get_admin_access_token(env: dict[str, str]) -> str:
    return (env.get("ADMIN_ACCESS_TOKEN") or env.get("ADMIN_BOOTSTRAP_TOKEN") or "").strip()


def info(message: str) -> None:
    print(f"[deploy] {message}")


def fail(message: str, code: int = 1) -> None:
    print(f"[deploy:error] {message}", file=sys.stderr)
    raise SystemExit(code)


def npm_executable() -> str:
    return "npm.cmd" if os.name == "nt" else "npm"


def npx_executable() -> str:
    return "npx.cmd" if os.name == "nt" else "npx"


def run(
    command: list[str],
    *,
    cwd: Path | None = None,
    capture_output: bool = False,
    input_text: str | None = None,
    env_overrides: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    info("running: " + " ".join(command))
    return subprocess.run(
        command,
        cwd=str(cwd or ROOT),
        check=True,
        capture_output=capture_output,
        text=True,
        encoding="utf-8",
        errors="replace",
        input=input_text,
        env={**os.environ, **(env_overrides or {})},
    )


def print_command_output(result: subprocess.CompletedProcess[str]) -> None:
    if result.stdout:
        print(result.stdout, end="" if result.stdout.endswith("\n") else "\n")
    if result.stderr:
        print(result.stderr, end="" if result.stderr.endswith("\n") else "\n", file=sys.stderr)


def parse_env_file(file_path: Path) -> dict[str, str]:
    if not file_path.exists():
        return {}

    values: dict[str, str] = {}
    for raw_line in file_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if value.startswith(("'", '"')) and value.endswith(("'", '"')) and len(value) >= 2:
            value = value[1:-1]
        values[key] = value
    return values


def upsert_env_value(file_path: Path, key: str, value: str) -> None:
    lines = file_path.read_text(encoding="utf-8").splitlines() if file_path.exists() else []
    updated = False
    new_lines: list[str] = []
    for raw_line in lines:
        stripped = raw_line.strip()
        if stripped.startswith(f"{key}="):
            new_lines.append(f'{key}="{value}"')
            updated = True
        else:
            new_lines.append(raw_line)

    if not updated:
        if new_lines and new_lines[-1] != "":
            new_lines.append("")
        new_lines.append(f'{key}="{value}"')

    file_path.write_text("\n".join(new_lines) + "\n", encoding="utf-8")


def load_env(required_keys: list[str] | None = None) -> dict[str, str]:
    if not ENV_FILE.exists():
        fail(f"missing {ENV_FILE.name}; create it and fill it first")

    file_values = parse_env_file(ENV_FILE)
    allowed_os_keys = set(ENV_OPTIONAL_DEFAULTS) | set(file_values)
    overrides = {key: value for key, value in os.environ.items() if key in allowed_os_keys and isinstance(value, str)}
    values = {**ENV_OPTIONAL_DEFAULTS, **file_values, **overrides}

    missing: list[str] = []
    for key in (required_keys or []):
      if key == "ADMIN_ACCESS_TOKEN":
        admin_token = get_admin_access_token(values)
        if not admin_token or admin_token.startswith("replace-with-"):
            missing.append(key)
        continue
      if not values.get(key) or values[key].startswith("replace-with-"):
          missing.append(key)
    if missing:
        fail("missing required deploy values: " + ", ".join(missing))
    return values


def looks_placeholder(value: str) -> bool:
    normalized = value.strip()
    return normalized == "" or normalized.startswith("replace-with-") or normalized in {"change-this-now", "change-this-admin-token", "jtzt-dev-secret-change-me"}


def discover_runtime_env_keys(env: dict[str, str]) -> list[str]:
    return sorted(
        key
        for key, value in env.items()
        if key not in NON_RUNTIME_ENV_KEYS and value.strip()
    )


def is_secret_runtime_key(key: str) -> bool:
    if key in NON_SECRET_RUNTIME_KEYS:
        return False
    if key.endswith("_KEY"):
        return True
    return any(marker in key for marker in SECRET_NAME_MARKERS)


def get_runtime_var_groups(env: dict[str, str]) -> tuple[dict[str, str], dict[str, str]]:
    public_vars: dict[str, str] = {}
    secrets: dict[str, str] = {}

    for key in discover_runtime_env_keys(env):
        value = env[key].strip()
        if not value:
            continue
        if is_secret_runtime_key(key):
            secrets[key] = value
        else:
            public_vars[key] = value

    return public_vars, secrets


def wrangler_env(env: dict[str, str]) -> dict[str, str]:
    return {
        "CLOUDFLARE_API_TOKEN": env["CLOUDFLARE_API_TOKEN"],
        "CLOUDFLARE_ACCOUNT_ID": env["CLOUDFLARE_ACCOUNT_ID"],
        "WRANGLER_SEND_METRICS": "false",
    }


def build_release_env(env: dict[str, str]) -> dict[str, str]:
    release_env = dict(env)
    release_env["APP_ENV"] = "production"
    version = release_env.get("APP_VERSION", "").strip()
    if version in {"", "dev"}:
        version = datetime.now(timezone.utc).strftime("%Y.%m.%d-%H%M%S")
    release_env["APP_VERSION"] = version

    admin_token = get_admin_access_token(release_env)
    if looks_placeholder(admin_token) or len(admin_token) < 24:
        admin_token = secrets.token_urlsafe(32)
        release_env["ADMIN_ACCESS_TOKEN"] = admin_token
        upsert_env_value(ENV_FILE, "ADMIN_ACCESS_TOKEN", admin_token)
        info("generated a strong ADMIN_ACCESS_TOKEN and persisted it into .env")

    jwt_secret = release_env.get("JWT_SECRET", "").strip()
    if looks_placeholder(jwt_secret) or len(jwt_secret) < 32:
        jwt_secret = secrets.token_urlsafe(48)
        release_env["JWT_SECRET"] = jwt_secret
        upsert_env_value(ENV_FILE, "JWT_SECRET", jwt_secret)
        info("generated a strong JWT_SECRET and persisted it into .env")

    return release_env


def ensure_wrangler_installed() -> None:
    try:
        run([npx_executable(), "wrangler", "--version"], capture_output=True)
    except Exception:
        run([npm_executable(), "install", "-D", "wrangler"])


def wrangler_command() -> list[str]:
    return [npx_executable(), "wrangler"]


def wrangler_config_path(env: dict[str, str]) -> Path:
    return ROOT / env["CLOUDFLARE_WRANGLER_CONFIG"]


def write_cloudflare_dev_vars(env: dict[str, str]) -> None:
    public_vars, secrets = get_runtime_var_groups(env)
    CLOUDFLARE_DEV_VARS_FILE.parent.mkdir(parents=True, exist_ok=True)
    CLOUDFLARE_DEV_VARS_FILE.write_text(
        "\n".join([*(f'{key}="{value}"' for key, value in {**public_vars, **secrets}.items()), ""]),
        encoding="utf-8",
    )
    info(f"wrote {CLOUDFLARE_DEV_VARS_FILE.relative_to(ROOT)}")


def build_wrangler_config(env: dict[str, str]) -> dict:
    worker_entry = Path(env["CLOUDFLARE_WORKER_ENTRY"]).relative_to("cloudflare").as_posix()
    public_vars, _ = get_runtime_var_groups(env)

    payload: dict = {
        "name": env["CLOUDFLARE_WORKER_NAME"],
        "main": f"./{worker_entry}",
        "compatibility_date": env["CLOUDFLARE_COMPATIBILITY_DATE"],
        "compatibility_flags": ["nodejs_compat"],
        "assets": {
            "directory": f"../{env['CLOUDFLARE_ASSETS_DIR']}",
            "not_found_handling": env["CLOUDFLARE_ASSETS_NOT_FOUND_HANDLING"],
        },
        "durable_objects": {
            "bindings": [
                {
                    "name": env["CLOUDFLARE_SYSTEM_DO_BINDING"],
                    "class_name": env["CLOUDFLARE_SYSTEM_DO_CLASS"],
                },
                {
                    "name": env["CLOUDFLARE_COMPANY_DO_BINDING"],
                    "class_name": env["CLOUDFLARE_COMPANY_DO_CLASS"],
                },
            ]
        },
        "migrations": [
            {
                "tag": env["CLOUDFLARE_DO_MIGRATION_TAG"],
                "new_sqlite_classes": [
                    env["CLOUDFLARE_SYSTEM_DO_CLASS"],
                    env["CLOUDFLARE_COMPANY_DO_CLASS"],
                ],
            }
        ],
        "vars": public_vars,
    }

    if env["CLOUDFLARE_ACCOUNT_ID"]:
        payload["account_id"] = env["CLOUDFLARE_ACCOUNT_ID"]
    if env["CLOUDFLARE_CUSTOM_DOMAIN"]:
        payload["routes"] = [{"pattern": env["CLOUDFLARE_CUSTOM_DOMAIN"], "custom_domain": True}]

    return payload


def write_wrangler_config(env: dict[str, str]) -> None:
    config_path = wrangler_config_path(env)
    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(json.dumps(build_wrangler_config(env), indent=2) + "\n", encoding="utf-8")
    info(f"wrote {config_path.relative_to(ROOT)}")


def set_secret(env: dict[str, str]) -> None:
    _, secrets = get_runtime_var_groups(env)
    for key, value in secrets.items():
        run(
            wrangler_command() + ["secret", "put", key, "--config", str(wrangler_config_path(env))],
            input_text=value,
            env_overrides=wrangler_env(env),
        )


def typecheck() -> None:
    run([npm_executable(), "run", "typecheck"])


def build_frontend() -> None:
    run([npm_executable(), "run", "build:frontend"])


def parse_deploy_output(output: str) -> dict[str, str | list[str] | None]:
    worker_urls = [line.strip() for line in output.splitlines() if line.strip().startswith("https://")]
    version_id = None
    startup_time = None
    for line in output.splitlines():
        stripped = line.strip()
        if stripped.startswith("Current Version ID:"):
            version_id = stripped.split(":", 1)[1].strip()
        if stripped.startswith("Worker Startup Time:"):
            startup_time = stripped.split(":", 1)[1].strip()
    return {
        "worker_urls": worker_urls,
        "version_id": version_id,
        "startup_time": startup_time,
    }


def print_deploy_report(env: dict[str, str], deploy_details: dict[str, str | list[str] | None]) -> None:
    deployed_at = datetime.now(timezone.utc).isoformat()
    worker_urls = deploy_details.get("worker_urls") or []
    version_id = deploy_details.get("version_id") or "unknown"
    startup_time = deploy_details.get("startup_time") or "unknown"

    print("")
    print("=== DEPLOY REPORT ===")
    print(f"Worker Name: {env['CLOUDFLARE_WORKER_NAME']}")
    print(f"Production URL: {worker_urls[0] if worker_urls else 'not detected'}")
    print(f"Version ID: {version_id}")
    print(f"Environment: {env['APP_ENV']}")
    print(f"App Version: {env['APP_VERSION']}")
    print(f"System DO: {env['CLOUDFLARE_SYSTEM_DO_BINDING']} -> {env['CLOUDFLARE_SYSTEM_DO_CLASS']}")
    print(f"Company DO: {env['CLOUDFLARE_COMPANY_DO_BINDING']} -> {env['CLOUDFLARE_COMPANY_DO_CLASS']}")
    print(f"Migration Tag: {env['CLOUDFLARE_DO_MIGRATION_TAG']}")
    print(f"Assets Directory: {env['CLOUDFLARE_ASSETS_DIR']}")
    print(f"Worker Startup Time: {startup_time}")
    print(f"Deployed At UTC: {deployed_at}")
    print("=====================")
    print("")


def curl_executable() -> str:
    return "curl.exe" if os.name == "nt" else "curl"


def curl_request(url: str, *, method: str = "GET", body: str | None = None, headers: dict[str, str] | None = None) -> tuple[int, str]:
    command = [
        curl_executable(),
        "--silent",
        "--show-error",
        "--location",
        "--max-time",
        "20",
        "--request",
        method,
        "--write-out",
        "\n__STATUS__:%{http_code}",
        "--user-agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
    ]
    for key, value in (headers or {}).items():
        command.extend(["--header", f"{key}: {value}"])
    if body is not None:
        command.extend(["--data", body])
    command.append(url)

    result = run(command, capture_output=True)
    combined = result.stdout or ""
    marker = "\n__STATUS__:"
    if marker not in combined:
        fail(f"curl smoke check did not return a status marker for {url}")
    response_body, status_text = combined.rsplit(marker, 1)
    return int(status_text.strip()), response_body


def run_post_deploy_smoke(env: dict[str, str], deploy_details: dict[str, str | list[str] | None]) -> None:
    worker_urls = deploy_details.get("worker_urls") or []
    if not worker_urls:
        fail("deploy succeeded but no worker URL was detected for smoke testing")

    base_url = str(worker_urls[0]).rstrip("/")
    health_status, health_body = curl_request(f"{base_url}/api/health")
    if health_status != 200:
        if "error code: 1010" in health_body.lower():
            fail(
                "post-deploy health check was blocked by Cloudflare edge security (1010) before the Worker executed; "
                "the deploy completed, but automated smoke verification could not reach the Worker URL"
            )
        fail(f"post-deploy health check failed with {health_status}: {health_body[:400]}")

    health_payload = json.loads(health_body)
    if health_payload.get("ok") is not True:
        fail(f"post-deploy health check returned unexpected payload: {health_body[:400]}")
    if health_payload.get("env") != "production":
        fail(f"post-deploy health check returned env={health_payload.get('env')!r}, expected 'production'")

    admin_token = get_admin_access_token(env)
    if admin_token:
        login_status, login_body = curl_request(
            f"{base_url}/api/admin/auth/login",
            method="POST",
            body=json.dumps({"token": admin_token}),
            headers={"Content-Type": "application/json"},
        )
        if login_status != 200:
            if "error code: 1010" in login_body.lower():
                fail(
                    "post-deploy admin login smoke was blocked by Cloudflare edge security (1010) before the Worker executed; "
                    "the deploy completed, but automated smoke verification could not reach the Worker URL"
                )
            fail(f"post-deploy admin login smoke failed with {login_status}: {login_body[:400]}")
        login_payload = json.loads(login_body)
        session = login_payload.get("session") or {}
        if session.get("actorType") != "admin" or not session.get("token"):
            fail(f"post-deploy admin login payload was invalid: {login_body[:400]}")


def deploy(env: dict[str, str]) -> dict[str, str | list[str] | None]:
    result = run(
        wrangler_command() + ["deploy", "--config", str(wrangler_config_path(env))],
        capture_output=True,
        env_overrides=wrangler_env(env),
    )
    print_command_output(result)
    deploy_details = parse_deploy_output((result.stdout or "") + "\n" + (result.stderr or ""))
    print_deploy_report(env, deploy_details)
    run_post_deploy_smoke(env, deploy_details)
    return deploy_details


def doctor(env: dict[str, str]) -> None:
    public_vars, secrets = get_runtime_var_groups(env)
    info(f"cloudflare account id: {env['CLOUDFLARE_ACCOUNT_ID']}")
    info(f"worker: {env['CLOUDFLARE_WORKER_NAME']}")
    info(f"wrangler config: {wrangler_config_path(env).relative_to(ROOT)}")
    info(f"worker entry: {env['CLOUDFLARE_WORKER_ENTRY']}")
    info(f"assets dir: {env['CLOUDFLARE_ASSETS_DIR']}")
    info(f"system DO: {env['CLOUDFLARE_SYSTEM_DO_BINDING']} -> {env['CLOUDFLARE_SYSTEM_DO_CLASS']}")
    info(f"company DO: {env['CLOUDFLARE_COMPANY_DO_BINDING']} -> {env['CLOUDFLARE_COMPANY_DO_CLASS']}")
    info(f"migration tag: {env['CLOUDFLARE_DO_MIGRATION_TAG']}")
    info(f"public runtime vars: {', '.join(public_vars.keys()) or '<none>'}")
    info(f"secret runtime vars: {', '.join(secrets.keys()) or '<none>'}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Jtzt Cloudflare Durable Objects deployment helper")
    parser.add_argument(
        "command",
        choices=["doctor", "install", "prepare-dev", "write-config", "typecheck", "build", "set-secret", "deploy", "full"],
        nargs="?",
        default="full",
    )
    return parser.parse_args()


def main() -> None:
    if not shutil.which(npm_executable()):
        fail("npm is required")

    args = parse_args()

    if args.command == "install":
        ensure_wrangler_installed()
        return

    env = load_env(COMMAND_REQUIRED_KEYS.get(args.command))

    if args.command == "doctor":
        doctor(env)
        return
    if args.command == "prepare-dev":
        write_cloudflare_dev_vars(env)
        write_wrangler_config(env)
        return
    if args.command == "write-config":
        write_wrangler_config(env)
        return
    if args.command == "typecheck":
        typecheck()
        return
    if args.command == "build":
        build_frontend()
        return
    if args.command == "set-secret":
        release_env = build_release_env(env)
        write_wrangler_config(release_env)
        set_secret(release_env)
        return
    if args.command == "deploy":
        release_env = build_release_env(env)
        write_wrangler_config(release_env)
        deploy(release_env)
        return
    if args.command == "full":
        release_env = build_release_env(env)
        ensure_wrangler_installed()
        write_wrangler_config(release_env)
        typecheck()
        build_frontend()
        set_secret(release_env)
        deploy(release_env)
        return

    fail(f"unsupported command: {args.command}")


if __name__ == "__main__":
    main()
