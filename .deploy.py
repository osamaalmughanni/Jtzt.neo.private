#!/usr/bin/env python3
"""
Cloudflare deployment orchestrator for Jtzt.

This script uses one canonical `.env` file for both local development and
Cloudflare deployment. It generates Cloudflare-specific artifacts from that
single env source, writes Wrangler config, applies D1 migrations, updates local
Wrangler dev vars, and deploys the Worker.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


# =========================
# CONSTANTS
# =========================
ROOT = Path(__file__).resolve().parent
ENV_FILE = ROOT / ".env"
CLOUDFLARE_DEV_VARS_FILE = ROOT / "cloudflare/.dev.vars"

DEFAULT_WRANGLER_CONFIG = "cloudflare/wrangler.jsonc"
DEFAULT_WORKER_ENTRY = "cloudflare/worker/index.ts"
DEFAULT_MIGRATIONS_DIR = "cloudflare/d1/migrations"
DEFAULT_ASSETS_DIR = "dist/frontend"
NON_RUNTIME_ENV_KEYS = {
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_CUSTOM_DOMAIN",
    "CLOUDFLARE_WRANGLER_CONFIG",
    "CLOUDFLARE_WORKER_ENTRY",
    "CLOUDFLARE_MIGRATIONS_DIR",
    "CLOUDFLARE_ASSETS_DIR",
    "CLOUDFLARE_ASSETS_NOT_FOUND_HANDLING",
    "CLOUDFLARE_WORKER_NAME",
    "CLOUDFLARE_COMPATIBILITY_DATE",
    "CLOUDFLARE_D1_BINDING",
    "CLOUDFLARE_D1_DATABASE_NAME",
    "CLOUDFLARE_D1_DATABASE_ID",
    "NODE_SQLITE_PATH",
}
NON_SECRET_RUNTIME_KEYS = {
    "APP_ENV",
    "APP_VERSION",
    "SESSION_TTL_HOURS",
}
SECRET_NAME_MARKERS = (
    "SECRET",
    "TOKEN",
    "PASSWORD",
    "PASSPHRASE",
)

ENV_REQUIRED = [
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_WORKER_NAME",
    "CLOUDFLARE_COMPATIBILITY_DATE",
    "CLOUDFLARE_D1_BINDING",
    "CLOUDFLARE_D1_DATABASE_NAME",
    "CLOUDFLARE_D1_DATABASE_ID",
    "JWT_SECRET",
]

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
    "CLOUDFLARE_MIGRATIONS_DIR": DEFAULT_MIGRATIONS_DIR,
    "CLOUDFLARE_ASSETS_DIR": DEFAULT_ASSETS_DIR,
    "CLOUDFLARE_ASSETS_NOT_FOUND_HANDLING": "single-page-application",
    "NODE_SQLITE_PATH": "data/app.db",
}

COMMAND_REQUIRED_KEYS = {
    "doctor": [
        "CLOUDFLARE_API_TOKEN",
        "CLOUDFLARE_ACCOUNT_ID",
        "CLOUDFLARE_WORKER_NAME",
        "CLOUDFLARE_COMPATIBILITY_DATE",
        "CLOUDFLARE_D1_BINDING",
        "CLOUDFLARE_D1_DATABASE_NAME",
        "JWT_SECRET",
    ],
    "prepare-dev": [
        "CLOUDFLARE_API_TOKEN",
        "CLOUDFLARE_ACCOUNT_ID",
        "CLOUDFLARE_WORKER_NAME",
        "CLOUDFLARE_COMPATIBILITY_DATE",
        "CLOUDFLARE_D1_BINDING",
        "CLOUDFLARE_D1_DATABASE_NAME",
        "JWT_SECRET",
        "ADMIN_ACCESS_TOKEN",
    ],
    "write-config": [
        "CLOUDFLARE_API_TOKEN",
        "CLOUDFLARE_ACCOUNT_ID",
        "CLOUDFLARE_WORKER_NAME",
        "CLOUDFLARE_COMPATIBILITY_DATE",
        "CLOUDFLARE_D1_BINDING",
        "CLOUDFLARE_D1_DATABASE_NAME",
    ],
    "d1-create": [
        "CLOUDFLARE_API_TOKEN",
        "CLOUDFLARE_ACCOUNT_ID",
        "CLOUDFLARE_D1_DATABASE_NAME",
    ],
    "migrate-local": [
        "CLOUDFLARE_API_TOKEN",
        "CLOUDFLARE_ACCOUNT_ID",
        "CLOUDFLARE_WORKER_NAME",
        "CLOUDFLARE_COMPATIBILITY_DATE",
        "CLOUDFLARE_D1_BINDING",
        "CLOUDFLARE_D1_DATABASE_NAME",
    ],
    "migrate-remote": [
        "CLOUDFLARE_API_TOKEN",
        "CLOUDFLARE_ACCOUNT_ID",
        "CLOUDFLARE_WORKER_NAME",
        "CLOUDFLARE_COMPATIBILITY_DATE",
        "CLOUDFLARE_D1_BINDING",
        "CLOUDFLARE_D1_DATABASE_NAME",
    ],
    "typecheck": [
        "JWT_SECRET",
    ],
    "build": [],
    "set-secret": [
        "CLOUDFLARE_API_TOKEN",
        "CLOUDFLARE_ACCOUNT_ID",
        "CLOUDFLARE_WORKER_NAME",
        "CLOUDFLARE_COMPATIBILITY_DATE",
        "CLOUDFLARE_D1_BINDING",
        "CLOUDFLARE_D1_DATABASE_NAME",
        "JWT_SECRET",
        "ADMIN_ACCESS_TOKEN",
    ],
    "deploy": [
        "CLOUDFLARE_API_TOKEN",
        "CLOUDFLARE_ACCOUNT_ID",
        "CLOUDFLARE_WORKER_NAME",
        "CLOUDFLARE_COMPATIBILITY_DATE",
        "CLOUDFLARE_D1_BINDING",
        "CLOUDFLARE_D1_DATABASE_NAME",
    ],
    "full": [
        "CLOUDFLARE_API_TOKEN",
        "CLOUDFLARE_ACCOUNT_ID",
        "CLOUDFLARE_WORKER_NAME",
        "CLOUDFLARE_COMPATIBILITY_DATE",
        "CLOUDFLARE_D1_BINDING",
        "CLOUDFLARE_D1_DATABASE_NAME",
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


def print_command_output(result: subprocess.CompletedProcess[str]) -> None:
    if result.stdout:
        try:
            print(result.stdout, end="" if result.stdout.endswith("\n") else "\n")
        except UnicodeEncodeError:
            sys.stdout.buffer.write(result.stdout.encode("utf-8", errors="replace"))
            if not result.stdout.endswith("\n"):
                sys.stdout.buffer.write(b"\n")
    if result.stderr:
        try:
            print(result.stderr, end="" if result.stderr.endswith("\n") else "\n", file=sys.stderr)
        except UnicodeEncodeError:
            sys.stderr.buffer.write(result.stderr.encode("utf-8", errors="replace"))
            if not result.stderr.endswith("\n"):
                sys.stderr.buffer.write(b"\n")


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


def discover_runtime_env_keys(env: dict[str, str]) -> list[str]:
    keys = [
        key
        for key, value in env.items()
        if key not in NON_RUNTIME_ENV_KEYS and value.strip()
    ]
    return sorted(set(keys))


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


def load_env(required_keys: list[str] | None = None) -> dict[str, str]:
    if not ENV_FILE.exists():
        fail(f"missing {ENV_FILE.name}; create it and fill it first")

    values = {**ENV_OPTIONAL_DEFAULTS, **parse_env_file(ENV_FILE), **{k: v for k, v in os.environ.items() if isinstance(v, str)}}
    missing: list[str] = []
    for key in (required_keys or ENV_REQUIRED):
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


def has_real_value(env: dict[str, str], key: str) -> bool:
    value = env.get(key, "").strip()
    return bool(value) and not value.startswith("replace-with-")


def wrangler_env(env: dict[str, str]) -> dict[str, str]:
    extra = {
        "CLOUDFLARE_API_TOKEN": env["CLOUDFLARE_API_TOKEN"],
        "CLOUDFLARE_ACCOUNT_ID": env["CLOUDFLARE_ACCOUNT_ID"],
        "WRANGLER_SEND_METRICS": "false",
    }
    return extra


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


def ensure_d1_database_id(env: dict[str, str]) -> dict[str, str]:
    if has_real_value(env, "CLOUDFLARE_D1_DATABASE_ID"):
        return env

    database_id = create_d1_database(env)
    env["CLOUDFLARE_D1_DATABASE_ID"] = database_id
    return env


def ensure_wrangler_installed() -> None:
    try:
        run([npx_executable(), "wrangler", "--version"], capture_output=True)
    except Exception:
        run([npm_executable(), "install", "-D", "wrangler"])


def wrangler_config_path(env: dict[str, str]) -> Path:
    return ROOT / env["CLOUDFLARE_WRANGLER_CONFIG"]


def wrangler_command() -> list[str]:
    return [npx_executable(), "wrangler"]


def write_cloudflare_dev_vars(env: dict[str, str]) -> None:
    public_vars, secrets = get_runtime_var_groups(env)
    CLOUDFLARE_DEV_VARS_FILE.parent.mkdir(parents=True, exist_ok=True)
    CLOUDFLARE_DEV_VARS_FILE.write_text(
        "\n".join(
            [*(f'{key}="{value}"' for key, value in {**public_vars, **secrets}.items()), ""]
        ),
        encoding="utf-8",
    )

    info(f"wrote {CLOUDFLARE_DEV_VARS_FILE.relative_to(ROOT)}")


def build_wrangler_config(env: dict[str, str]) -> dict:
    worker_entry = Path(env["CLOUDFLARE_WORKER_ENTRY"]).relative_to("cloudflare").as_posix()
    migrations_dir = Path(env["CLOUDFLARE_MIGRATIONS_DIR"]).relative_to("cloudflare").as_posix()
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
        "d1_databases": [
            {
                "binding": env["CLOUDFLARE_D1_BINDING"],
                "database_name": env["CLOUDFLARE_D1_DATABASE_NAME"],
                "database_id": env["CLOUDFLARE_D1_DATABASE_ID"],
                "migrations_dir": f"./{migrations_dir}",
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


def create_d1_database(env: dict[str, str]) -> str:
    result = run(
        wrangler_command() + ["d1", "create", env["CLOUDFLARE_D1_DATABASE_NAME"]],
        capture_output=True,
        env_overrides=wrangler_env(env),
    )
    print(result.stdout)
    match = re.search(r'database_id\s*=\s*"([^"]+)"', result.stdout)
    if match:
        database_id = match.group(1)
        upsert_env_value(ENV_FILE, "CLOUDFLARE_D1_DATABASE_ID", database_id)
        info(f"persisted CLOUDFLARE_D1_DATABASE_ID into {ENV_FILE.name}")
        return database_id
    fail("unable to detect CLOUDFLARE_D1_DATABASE_ID from wrangler output")
    return ""


def apply_migrations(env: dict[str, str], remote: bool) -> None:
    mode = "--remote" if remote else "--local"
    run(
        wrangler_command() + ["d1", "migrations", "apply", env["CLOUDFLARE_D1_DATABASE_NAME"], mode, "--config", str(wrangler_config_path(env))],
        env_overrides=wrangler_env(env),
    )


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
    worker_urls = re.findall(r"https://[^\s]+", output)
    version_match = re.search(r"Current Version ID:\s*([A-Za-z0-9-]+)", output)
    startup_match = re.search(r"Worker Startup Time:\s*([^\n]+)", output)

    return {
        "worker_urls": worker_urls,
        "version_id": version_match.group(1) if version_match else None,
        "startup_time": startup_match.group(1).strip() if startup_match else None,
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
    if len(worker_urls) > 1:
        print("Worker URLs:")
        for url in worker_urls:
            print(f"- {url}")
    print(f"Version ID: {version_id}")
    print(f"Environment: {env['APP_ENV']}")
    print(f"App Version: {env['APP_VERSION']}")
    print(f"D1 Database: {env['CLOUDFLARE_D1_DATABASE_NAME']}")
    print(f"D1 Database ID: {env['CLOUDFLARE_D1_DATABASE_ID']}")
    print(f"D1 Binding: {env['CLOUDFLARE_D1_BINDING']}")
    print(f"Assets Directory: {env['CLOUDFLARE_ASSETS_DIR']}")
    print(f"Worker Startup Time: {startup_time}")
    print(f"Deployed At UTC: {deployed_at}")
    print("=====================")
    print("")


def deploy(env: dict[str, str]) -> dict[str, str | list[str] | None]:
    result = run(
        wrangler_command() + ["deploy", "--config", str(wrangler_config_path(env))],
        capture_output=True,
        env_overrides=wrangler_env(env),
    )
    print_command_output(result)
    deploy_details = parse_deploy_output((result.stdout or "") + "\n" + (result.stderr or ""))
    print_deploy_report(env, deploy_details)
    return deploy_details


def doctor(env: dict[str, str]) -> None:
    public_vars, secrets = get_runtime_var_groups(env)
    info("cloudflare auth: api token")
    info(f"cloudflare account id: {env['CLOUDFLARE_ACCOUNT_ID']}")
    info(f"worker: {env['CLOUDFLARE_WORKER_NAME']}")
    info(f"d1 database: {env['CLOUDFLARE_D1_DATABASE_NAME']}")
    info(f"d1 database id: {env.get('CLOUDFLARE_D1_DATABASE_ID', '<not set yet>')}")
    info(f"wrangler config: {wrangler_config_path(env).relative_to(ROOT)}")
    info(f"worker entry: {env['CLOUDFLARE_WORKER_ENTRY']}")
    info(f"migrations dir: {env['CLOUDFLARE_MIGRATIONS_DIR']}")
    info(f"assets dir: {env['CLOUDFLARE_ASSETS_DIR']}")
    info(f"public runtime vars: {', '.join(public_vars.keys()) or '<none>'}")
    info(f"secret runtime vars: {', '.join(secrets.keys()) or '<none>'}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Jtzt Cloudflare deployment helper")
    parser.add_argument("command", choices=[
        "doctor",
        "install",
        "prepare-dev",
        "write-config",
        "d1-create",
        "migrate-local",
        "migrate-remote",
        "typecheck",
        "build",
        "set-secret",
        "deploy",
        "full",
    ])
    return parser.parse_args()


def main() -> None:
    if not shutil.which(npm_executable()):
        fail("npm is required")

    args = parse_args()

    if args.command == "install":
        ensure_wrangler_installed()
        return

    env = load_env(COMMAND_REQUIRED_KEYS.get(args.command))

    if args.command in {"prepare-dev", "write-config", "migrate-local", "migrate-remote", "set-secret", "deploy", "full"}:
        env = ensure_d1_database_id(env)

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

    if args.command == "d1-create":
        create_d1_database(env)
        return

    if args.command == "migrate-local":
        write_wrangler_config(env)
        apply_migrations(env, remote=False)
        return

    if args.command == "migrate-remote":
        write_wrangler_config(env)
        apply_migrations(env, remote=True)
        return

    if args.command == "typecheck":
        typecheck()
        return

    if args.command == "build":
        build_frontend()
        return

    if args.command == "set-secret":
        write_wrangler_config(env)
        set_secret(env)
        return

    if args.command == "deploy":
        write_wrangler_config(env)
        deploy(env)
        return

    if args.command == "full":
        ensure_wrangler_installed()
        write_cloudflare_dev_vars(env)
        write_wrangler_config(env)
        typecheck()
        build_frontend()
        apply_migrations(env, remote=True)
        set_secret(env)
        deploy(env)
        return

    fail(f"unsupported command: {args.command}")


if __name__ == "__main__":
    main()
