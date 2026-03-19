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
from pathlib import Path


# =========================
# CONSTANTS
# =========================
ROOT = Path(__file__).resolve().parent
ENV_FILE = ROOT / ".env"
ENV_EXAMPLE_FILE = ROOT / ".env.example"
CLOUDFLARE_DEV_VARS_FILE = ROOT / "cloudflare/.dev.vars"

DEFAULT_WRANGLER_CONFIG = "cloudflare/wrangler.jsonc"
DEFAULT_WORKER_ENTRY = "cloudflare/worker/index.ts"
DEFAULT_MIGRATIONS_DIR = "cloudflare/d1/migrations"
DEFAULT_ASSETS_DIR = "dist/frontend"

ENV_REQUIRED = [
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
    "ADMIN_BOOTSTRAP_USERNAME": "admin",
    "ADMIN_BOOTSTRAP_PASSWORD": "admin123",
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
        "CLOUDFLARE_WORKER_NAME",
        "CLOUDFLARE_COMPATIBILITY_DATE",
        "CLOUDFLARE_D1_BINDING",
        "CLOUDFLARE_D1_DATABASE_NAME",
        "JWT_SECRET",
    ],
    "prepare-dev": [
        "CLOUDFLARE_WORKER_NAME",
        "CLOUDFLARE_COMPATIBILITY_DATE",
        "CLOUDFLARE_D1_BINDING",
        "CLOUDFLARE_D1_DATABASE_NAME",
        "CLOUDFLARE_D1_DATABASE_ID",
        "JWT_SECRET",
    ],
    "write-config": [
        "CLOUDFLARE_WORKER_NAME",
        "CLOUDFLARE_COMPATIBILITY_DATE",
        "CLOUDFLARE_D1_BINDING",
        "CLOUDFLARE_D1_DATABASE_NAME",
        "CLOUDFLARE_D1_DATABASE_ID",
    ],
    "login": [],
    "d1-create": [
        "CLOUDFLARE_D1_DATABASE_NAME",
    ],
    "migrate-local": [
        "CLOUDFLARE_WORKER_NAME",
        "CLOUDFLARE_COMPATIBILITY_DATE",
        "CLOUDFLARE_D1_BINDING",
        "CLOUDFLARE_D1_DATABASE_NAME",
        "CLOUDFLARE_D1_DATABASE_ID",
    ],
    "migrate-remote": [
        "CLOUDFLARE_WORKER_NAME",
        "CLOUDFLARE_COMPATIBILITY_DATE",
        "CLOUDFLARE_D1_BINDING",
        "CLOUDFLARE_D1_DATABASE_NAME",
        "CLOUDFLARE_D1_DATABASE_ID",
    ],
    "typecheck": [
        "JWT_SECRET",
    ],
    "build": [],
    "set-secret": [
        "CLOUDFLARE_WORKER_NAME",
        "CLOUDFLARE_COMPATIBILITY_DATE",
        "CLOUDFLARE_D1_BINDING",
        "CLOUDFLARE_D1_DATABASE_NAME",
        "CLOUDFLARE_D1_DATABASE_ID",
        "JWT_SECRET",
    ],
    "deploy": [
        "CLOUDFLARE_WORKER_NAME",
        "CLOUDFLARE_COMPATIBILITY_DATE",
        "CLOUDFLARE_D1_BINDING",
        "CLOUDFLARE_D1_DATABASE_NAME",
        "CLOUDFLARE_D1_DATABASE_ID",
    ],
    "full": ENV_REQUIRED,
}


def info(message: str) -> None:
    print(f"[deploy] {message}")


def fail(message: str, code: int = 1) -> None:
    print(f"[deploy:error] {message}", file=sys.stderr)
    raise SystemExit(code)


def npm_executable() -> str:
    return "npm.cmd" if os.name == "nt" else "npm"


def npx_executable() -> str:
    return "npx.cmd" if os.name == "nt" else "npx"


def run(command: list[str], *, cwd: Path | None = None, capture_output: bool = False, input_text: str | None = None) -> subprocess.CompletedProcess[str]:
    info("running: " + " ".join(command))
    return subprocess.run(
        command,
        cwd=str(cwd or ROOT),
        check=True,
        capture_output=capture_output,
        text=True,
        input=input_text,
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


def load_env(required_keys: list[str] | None = None) -> dict[str, str]:
    if not ENV_FILE.exists():
        fail(f"missing {ENV_FILE.name}; copy {ENV_EXAMPLE_FILE.name} and fill it first")

    values = {**ENV_OPTIONAL_DEFAULTS, **parse_env_file(ENV_FILE), **{k: v for k, v in os.environ.items() if isinstance(v, str)}}
    missing = [key for key in (required_keys or ENV_REQUIRED) if not values.get(key) or values[key].startswith("replace-with-")]
    if missing:
        fail("missing required deploy values: " + ", ".join(missing))
    return values


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
    CLOUDFLARE_DEV_VARS_FILE.parent.mkdir(parents=True, exist_ok=True)
    CLOUDFLARE_DEV_VARS_FILE.write_text(
        "\n".join(
            [
                f'JWT_SECRET="{env["JWT_SECRET"]}"',
                f'APP_ENV="{env["APP_ENV"]}"',
                f'APP_VERSION="{env["APP_VERSION"]}"',
                f'SESSION_TTL_HOURS="{env["SESSION_TTL_HOURS"]}"',
                f'ADMIN_BOOTSTRAP_USERNAME="{env["ADMIN_BOOTSTRAP_USERNAME"]}"',
                f'ADMIN_BOOTSTRAP_PASSWORD="{env["ADMIN_BOOTSTRAP_PASSWORD"]}"',
                "",
            ]
        ),
        encoding="utf-8",
    )

    info(f"wrote {CLOUDFLARE_DEV_VARS_FILE.relative_to(ROOT)}")


def build_wrangler_config(env: dict[str, str]) -> dict:
    worker_entry = Path(env["CLOUDFLARE_WORKER_ENTRY"]).relative_to("cloudflare").as_posix()
    migrations_dir = Path(env["CLOUDFLARE_MIGRATIONS_DIR"]).relative_to("cloudflare").as_posix()

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
        "vars": {
            "APP_ENV": env["APP_ENV"],
            "APP_VERSION": env["APP_VERSION"],
            "SESSION_TTL_HOURS": env["SESSION_TTL_HOURS"],
            "ADMIN_BOOTSTRAP_USERNAME": env["ADMIN_BOOTSTRAP_USERNAME"],
            "ADMIN_BOOTSTRAP_PASSWORD": env["ADMIN_BOOTSTRAP_PASSWORD"],
        },
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


def login() -> None:
    run(wrangler_command() + ["login"])


def create_d1_database(env: dict[str, str]) -> None:
    result = run(wrangler_command() + ["d1", "create", env["CLOUDFLARE_D1_DATABASE_NAME"]], capture_output=True)
    print(result.stdout)
    match = re.search(r'database_id\s*=\s*"([^"]+)"', result.stdout)
    if match:
        info(f"detected database id: {match.group(1)}")
        info(f"copy it into {ENV_FILE.name} as CLOUDFLARE_D1_DATABASE_ID")


def apply_migrations(env: dict[str, str], remote: bool) -> None:
    mode = "--remote" if remote else "--local"
    run(wrangler_command() + ["d1", "migrations", "apply", env["CLOUDFLARE_D1_DATABASE_NAME"], mode, "--config", str(wrangler_config_path(env))])


def set_secret(env: dict[str, str]) -> None:
    run(wrangler_command() + ["secret", "put", "JWT_SECRET", "--config", str(wrangler_config_path(env))], input_text=env["JWT_SECRET"])


def typecheck() -> None:
    run([npm_executable(), "run", "typecheck"])


def build_frontend() -> None:
    run([npm_executable(), "run", "build:frontend"])


def deploy(env: dict[str, str]) -> None:
    run(wrangler_command() + ["deploy", "--config", str(wrangler_config_path(env))])


def doctor(env: dict[str, str]) -> None:
    info(f"worker: {env['CLOUDFLARE_WORKER_NAME']}")
    info(f"d1 database: {env['CLOUDFLARE_D1_DATABASE_NAME']}")
    info(f"d1 database id: {env.get('CLOUDFLARE_D1_DATABASE_ID', '<not set yet>')}")
    info(f"wrangler config: {wrangler_config_path(env).relative_to(ROOT)}")
    info(f"worker entry: {env['CLOUDFLARE_WORKER_ENTRY']}")
    info(f"migrations dir: {env['CLOUDFLARE_MIGRATIONS_DIR']}")
    info(f"assets dir: {env['CLOUDFLARE_ASSETS_DIR']}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Jtzt Cloudflare deployment helper")
    parser.add_argument("command", choices=[
        "doctor",
        "install",
        "prepare-dev",
        "write-config",
        "login",
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

    if args.command == "login":
        login()
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
