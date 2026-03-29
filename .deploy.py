#!/usr/bin/env python3
"""
Hetzner deployment helper for Jtzt (Node + SQLite only).

Remote filesystem layout:
  /opt/jtzt/
    releases/<release_id>/           # immutable releases
    current -> releases/<release_id> # active release
    previous -> releases/<release_id>
  /var/lib/jtzt/
    system.db
    companies/*.sqlite
  /etc/jtzt/jtzt.env                 # runtime environment file
  /var/backups/jtzt/<release_id>/    # sqlite backups before migration

Commands this script runs (remote):
  mkdir -p /opt/jtzt/releases /var/lib/jtzt/companies /var/backups/jtzt /etc/jtzt
  systemctl daemon-reload
  systemctl enable jtzt
  systemctl stop jtzt
  cp -a /var/lib/jtzt/. /var/backups/jtzt/<release_id>/
  node <release>/dist/backend/server.js migrate
  ln -sfn /opt/jtzt/releases/<release_id> /opt/jtzt/current
  systemctl start jtzt
  curl -fsS <health_url>
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import select
import secrets
import shutil
import shlex
import tarfile
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

for stream_name in ("stdout", "stderr"):
    stream = getattr(sys, stream_name, None)
    if stream is not None and hasattr(stream, "reconfigure"):
        try:
            stream.reconfigure(encoding="utf-8")
        except Exception:
            pass

ROOT = Path(__file__).resolve().parent
ENV_FILE = ROOT / ".env"

DEPLOY_DEFAULTS = {
    "DEPLOY_HOST": "91.99.214.245",
    "DEPLOY_USER": "root",
    "DEPLOY_PORT": "22",
    "DEPLOY_KEY_PATH": "",
    "DEPLOY_APP_NAME": "jtzt",
    "DEPLOY_DOMAIN": "app.jtzt.com",
    "DEPLOY_BASE_DIR": "/opt/jtzt",
    "DEPLOY_SHARED_DIR": "/var/lib/jtzt",
    "DEPLOY_PUBLIC_DIR": "/var/lib/jtzt/public",
    "DEPLOY_BACKUP_DIR": "/var/backups/jtzt",
    "DEPLOY_ENV_PATH": "/etc/jtzt/jtzt.env",
    "DEPLOY_SERVICE": "jtzt",
    "DEPLOY_HEALTH_URL": "http://127.0.0.1:3000/api/health",
    "DEPLOY_ACCESS_URL": "http://91.99.214.245:3000",
}

REMOTE_DEPLOY_STATE_PATH = "/etc/jtzt/deploy-state.json"
REMOTE_NPM_CACHE_DIR = "/var/lib/jtzt/npm-cache"

RUNTIME_DEFAULTS = {
    "APP_ENV": "production",
    "APP_VERSION": "dev",
    "SESSION_TTL_HOURS": "12",
    "PORT": "3000",
    "NODE_SYSTEM_SQLITE_PATH": "/var/lib/jtzt/system.db",
    "NODE_COMPANY_SQLITE_DIR": "/var/lib/jtzt/companies",
    "ADMIN_ACCESS_TOKEN": "",
    "ADMIN_BOOTSTRAP_TOKEN": "",
}

REQUIRED_RUNTIME_KEYS = ["JWT_SECRET", "ADMIN_ACCESS_TOKEN"]

SECRET_NAME_MARKERS = ("SECRET", "TOKEN", "PASSWORD", "PASSPHRASE")
NON_SECRET_RUNTIME_KEYS = {"APP_ENV", "APP_VERSION", "SESSION_TTL_HOURS", "PORT", "NODE_SYSTEM_SQLITE_PATH", "NODE_COMPANY_SQLITE_DIR"}


def info(message: str) -> None:
    print(f"[deploy] {message}")


def color(text: str, code: str) -> str:
    return f"\033[{code}m{text}\033[0m"


def bold(text: str) -> str:
    return color(text, "1")


def green(text: str) -> str:
    return color(text, "32")


def cyan(text: str) -> str:
    return color(text, "36")


def yellow(text: str) -> str:
    return color(text, "33")


def magenta(text: str) -> str:
    return color(text, "35")


def blue(text: str) -> str:
    return color(text, "34")


def white(text: str) -> str:
    return color(text, "97")


def dim(text: str) -> str:
    return color(text, "90")


def red(text: str) -> str:
    return color(text, "31")


def fail(message: str, code: int = 1) -> None:
    print(f"[deploy:error] {message}", file=sys.stderr)
    raise SystemExit(code)


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def hash_release_inputs() -> str:
    digest = hashlib.sha256()
    for root in release_paths():
        if not root.exists():
            fail(f"missing release artifact: {root}")
        if root.is_file():
            digest.update(f"F\0{root.relative_to(ROOT).as_posix()}\0".encode("utf-8"))
            digest.update(root.read_bytes())
            continue

        for path in sorted((item for item in root.rglob("*") if item.is_file()), key=lambda item: item.relative_to(ROOT).as_posix()):
            digest.update(f"F\0{path.relative_to(ROOT).as_posix()}\0".encode("utf-8"))
            digest.update(path.read_bytes())

    return digest.hexdigest()


def hash_dependency_inputs() -> str:
    digest = hashlib.sha256()
    for path in (ROOT / "package.json", ROOT / "package-lock.json"):
        if not path.exists():
            fail(f"missing dependency artifact: {path}")
        digest.update(f"{path.relative_to(ROOT).as_posix()}\0".encode("utf-8"))
        digest.update(path.read_bytes())
    return digest.hexdigest()


def pause_on_success(timeout_seconds: int = 10) -> None:
    if not sys.stdin.isatty() or not sys.stdout.isatty():
        return

    print("")
    print(green(bold("DEPLOY SUCCESS")))
    print("Press Enter to close now.")
    print("")
    print(">", end=" ", flush=True)

    if os.name == "nt":
        try:
            import msvcrt
        except Exception:
            input()
            return

        while True:
            if msvcrt.kbhit():
                key = msvcrt.getwch()
                if key in ("\r", "\n"):
                    print("")
                    return
                if key == "\x03":
                    raise KeyboardInterrupt
            time.sleep(1)
    else:
        while True:
            ready, _, _ = select.select([sys.stdin], [], [], 1)
            if ready:
                sys.stdin.readline()
                print("")
                return


def run(command: list[str], *, cwd: Path | None = None, capture_output: bool = False, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    if os.name == "nt" and command and command[0] == "npm":
        command = ["cmd", "/c", "npm", *command[1:]]
    info("running: " + " ".join(command))
    return subprocess.run(
        command,
        cwd=str(cwd or ROOT),
        check=True,
        capture_output=capture_output,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=env or os.environ.copy(),
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


def load_env() -> dict[str, str]:
    values = {**DEPLOY_DEFAULTS, **RUNTIME_DEFAULTS, **parse_env_file(ENV_FILE)}
    values = {**values, **{k: v for k, v in os.environ.items() if isinstance(v, str) and k in values}}
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


def looks_placeholder(value: str) -> bool:
    normalized = value.strip()
    return normalized == "" or normalized.startswith("replace-with-") or normalized in {"change-this-now", "change-this-admin-token", "jtzt-dev-secret-change-me"}


def get_admin_access_token(env: dict[str, str]) -> str:
    return (env.get("ADMIN_ACCESS_TOKEN") or env.get("ADMIN_BOOTSTRAP_TOKEN") or "").strip()


def build_release_env(env: dict[str, str], *, allow_generate: bool) -> dict[str, str]:
    release_env = dict(env)
    release_env["APP_ENV"] = "production"
    release_env["PORT"] = "3000"
    release_env["NODE_SYSTEM_SQLITE_PATH"] = "/var/lib/jtzt/system.db"
    release_env["NODE_COMPANY_SQLITE_DIR"] = "/var/lib/jtzt/companies"
    version = release_env.get("APP_VERSION", "").strip()
    if version in {"", "dev"}:
        version = datetime.now(timezone.utc).strftime("%Y.%m.%d-%H%M%S")
        release_env["APP_VERSION"] = version

    admin_token = get_admin_access_token(release_env)
    if allow_generate and (looks_placeholder(admin_token) or len(admin_token) < 24):
        admin_token = secrets.token_urlsafe(32)
        release_env["ADMIN_ACCESS_TOKEN"] = admin_token
        if not ENV_FILE.exists():
            ENV_FILE.write_text("", encoding="utf-8")
        upsert_env_value(ENV_FILE, "ADMIN_ACCESS_TOKEN", admin_token)
        info("generated a strong ADMIN_ACCESS_TOKEN and persisted it into .env")

    jwt_secret = release_env.get("JWT_SECRET", "").strip()
    if allow_generate and (looks_placeholder(jwt_secret) or len(jwt_secret) < 32):
        jwt_secret = secrets.token_urlsafe(48)
        release_env["JWT_SECRET"] = jwt_secret
        if not ENV_FILE.exists():
            ENV_FILE.write_text("", encoding="utf-8")
        upsert_env_value(ENV_FILE, "JWT_SECRET", jwt_secret)
        info("generated a strong JWT_SECRET and persisted it into .env")

    return release_env


def validate_env(env: dict[str, str]) -> None:
    missing: list[str] = []
    for key in REQUIRED_RUNTIME_KEYS:
        if key == "ADMIN_ACCESS_TOKEN":
            value = get_admin_access_token(env)
        else:
            value = env.get(key, "")
        if looks_placeholder(value) or value == "":
            missing.append(key)
    if missing:
        fail("missing required values: " + ", ".join(missing))


def ensure_local_tools() -> None:
    for tool in ("ssh",):
        if not shutil.which(tool):
            fail(f"{tool} is required on the local machine")


def ssh_base_args(env: dict[str, str]) -> list[str]:
    args = ["ssh", "-p", env["DEPLOY_PORT"], "-o", "ConnectTimeout=10", "-o", "StrictHostKeyChecking=accept-new"]
    if env.get("DEPLOY_KEY_PATH"):
        args.extend(["-i", env["DEPLOY_KEY_PATH"], "-o", "BatchMode=yes"])
    return args


def remote_target(env: dict[str, str]) -> str:
    return f"{env['DEPLOY_USER']}@{env['DEPLOY_HOST']}"


def remote_run(env: dict[str, str], command: str, *, capture_output: bool = False) -> subprocess.CompletedProcess[str]:
    return run(ssh_base_args(env) + [remote_target(env), f"bash -lc {shlex.quote(command)}"], capture_output=capture_output)


def remote_write_text_if_changed(env: dict[str, str], path: str, contents: str) -> bool:
    encoded_contents = base64.b64encode(contents.encode("utf-8")).decode("ascii")
    result = remote_run(
        env,
        f"""
python3 - <<'PY'
from __future__ import annotations

import base64
import hashlib
from pathlib import Path

path = Path({path!r})
desired = base64.b64decode({encoded_contents!r}).decode("utf-8")
desired_hash = hashlib.sha256(desired.encode("utf-8")).hexdigest()
current = path.read_text(encoding="utf-8") if path.exists() else ""
current_hash = hashlib.sha256(current.encode("utf-8")).hexdigest() if path.exists() else ""

if current_hash == desired_hash:
    print("unchanged")
    raise SystemExit(0)

path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(desired, encoding="utf-8")
print("updated")
PY
""".strip(),
        capture_output=True,
    )
    return (result.stdout or "").strip() == "updated"


def read_remote_deploy_state(env: dict[str, str]) -> dict[str, str]:
    result = remote_run(
        env,
        f"""
python3 - <<'PY'
from pathlib import Path

path = Path({REMOTE_DEPLOY_STATE_PATH!r})
if path.exists():
    print(path.read_text(encoding="utf-8"), end="")
PY
""".strip(),
        capture_output=True,
    )
    raw_state = (result.stdout or "").strip()
    if not raw_state:
        return {}
    try:
        data = json.loads(raw_state)
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def write_remote_deploy_state(env: dict[str, str], state: dict[str, str]) -> bool:
    encoded_state = base64.b64encode(json.dumps(state, indent=2, sort_keys=True).encode("utf-8")).decode("ascii")
    result = remote_run(
        env,
        f"""
python3 - <<'PY'
from __future__ import annotations

import base64
import hashlib
from pathlib import Path

path = Path({REMOTE_DEPLOY_STATE_PATH!r})
desired = base64.b64decode({encoded_state!r}).decode("utf-8")
desired_hash = hashlib.sha256(desired.encode("utf-8")).hexdigest()
current = path.read_text(encoding="utf-8") if path.exists() else ""
current_hash = hashlib.sha256(current.encode("utf-8")).hexdigest() if path.exists() else ""

if current_hash == desired_hash:
    print("unchanged")
    raise SystemExit(0)

path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(desired, encoding="utf-8")
print("updated")
PY
""".strip(),
        capture_output=True,
    )
    return (result.stdout or "").strip() == "updated"


def build_assets() -> None:
    run(["npm", "run", "typecheck"])
    run(["npm", "run", "build:frontend"])
    run(["npm", "run", "build:backend"])


def release_id(fingerprint: str | None = None) -> str:
    try:
        result = run(["git", "rev-parse", "--short", "HEAD"], capture_output=True)
        sha = (result.stdout or "").strip()
    except Exception:
        sha = "nogit"
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    suffix = fingerprint[:12] if fingerprint else sha
    return f"{stamp}-{suffix}"


def render_runtime_env(env: dict[str, str]) -> str:
    keys = ["APP_ENV", "APP_VERSION", "SESSION_TTL_HOURS", "PORT", "NODE_SYSTEM_SQLITE_PATH", "NODE_COMPANY_SQLITE_DIR", "JWT_SECRET", "ADMIN_ACCESS_TOKEN", "ADMIN_BOOTSTRAP_TOKEN"]
    lines: list[str] = []
    for key in keys:
        value = env.get(key, "")
        if key == "ADMIN_ACCESS_TOKEN":
            value = get_admin_access_token(env)
        if key == "ADMIN_BOOTSTRAP_TOKEN" and not value:
            continue
        if key in RUNTIME_DEFAULTS and not value:
            value = RUNTIME_DEFAULTS[key]
        if key in {"JWT_SECRET", "ADMIN_ACCESS_TOKEN", "ADMIN_BOOTSTRAP_TOKEN"} and not value:
            continue
        lines.append(f"{key}={value}")
    return "\n".join(lines) + "\n"


def render_systemd_unit(env: dict[str, str]) -> str:
    return f"""[Unit]
Description=Jtzt API
After=network.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile={env['DEPLOY_ENV_PATH']}
WorkingDirectory={env['DEPLOY_BASE_DIR']}/current
ExecStart=/usr/bin/env node {env['DEPLOY_BASE_DIR']}/current/dist/backend/server.js
Restart=always
RestartSec=2
TimeoutStartSec=120
LimitNOFILE=1048576

[Install]
WantedBy=multi-user.target
"""


def build_deploy_state(env: dict[str, str], *, release_fingerprint: str, release_id: str) -> dict[str, str]:
    caddyfile = render_caddyfile(env)
    systemd_unit = render_systemd_unit(env)
    runtime_env = render_runtime_env(env)
    state: dict[str, str] = {
        "schema": "1",
        "release_fingerprint": release_fingerprint,
        "release_id": release_id,
        "dependencies_hash": hash_dependency_inputs(),
        "systemd_unit_hash": sha256_text(systemd_unit),
        "runtime_env_hash": sha256_text(runtime_env),
        "firewall_hash": sha256_text(json.dumps({
            "ports": [22, 80, 443, 3000],
            "enabled": True,
        }, sort_keys=True, separators=(",", ":"))),
        "prereqs_hash": sha256_text("\n".join([
            "nodejs",
            "npm",
            "tar",
            "curl",
            "ca-certificates",
            "build-essential",
            "python3",
            "make",
            "g++",
        ])),
    }
    if caddyfile:
        state["caddyfile_hash"] = sha256_text(caddyfile)
    return state


def build_bootstrap_state(env: dict[str, str]) -> dict[str, str]:
    state = build_deploy_state(env, release_fingerprint="bootstrap", release_id="bootstrap")
    return state


def bootstrap_inputs_match_state(env: dict[str, str], state: dict[str, str]) -> bool:
    desired = build_bootstrap_state(env)
    for key in ("systemd_unit_hash", "runtime_env_hash", "caddyfile_hash"):
        desired_value = desired.get(key)
        current_value = state.get(key)
        if desired_value != current_value:
            return False
    return True


def access_url(env: dict[str, str]) -> str:
    return env.get("DEPLOY_ACCESS_URL", "").strip() or f"http://{env['DEPLOY_HOST']}:{env['PORT']}"


def deploy_domain(env: dict[str, str]) -> str:
    return env.get("DEPLOY_DOMAIN", "").strip()


def website_url(env: dict[str, str]) -> str:
    domain = deploy_domain(env)
    if domain:
        return f"https://{domain}"
    return access_url(env)


def backend_url(env: dict[str, str]) -> str:
    return env.get("DEPLOY_ACCESS_URL", "").strip() or f"http://{env['DEPLOY_HOST']}:{env['PORT']}"


def render_caddyfile(env: dict[str, str]) -> str:
    domain = deploy_domain(env)
    if not domain:
        return ""
    return f"""{domain} {{
  encode zstd gzip

  handle /api/* {{
    reverse_proxy 127.0.0.1:{env['PORT']}
  }}

  handle {{
    root * {env['DEPLOY_PUBLIC_DIR']}
    try_files {{path}} /index.html
    file_server
  }}
}}
"""


def print_report(
    env: dict[str, str],
    release: str | None = None,
    *,
    size_text: str | None = None,
    cleanup_text: str | None = None,
) -> None:
    print("")
    print(green(bold("JTZT DEPLOY REPORT")))
    print(cyan("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"))
    if release:
        print(f"{bold('Release')}      {release}")
    print(f"{bold('Host')}         {env['DEPLOY_HOST']}")
    print(f"{bold('SSH')}          {env['DEPLOY_USER']}@{env['DEPLOY_HOST']}:{env['DEPLOY_PORT']}")
    print(f"{bold('Website')}      {yellow(website_url(env))}")
    print(f"{bold('Backend')}      {yellow(backend_url(env))}")
    print(f"{bold('Domain')}       {yellow(deploy_domain(env) or '(none)')}")
    print(f"{bold('Proxy')}        Caddy + Let's Encrypt")
    print(f"{bold('Health')}       {yellow(env['DEPLOY_HEALTH_URL'])}")
    print("")
    print(cyan("Storage"))
    print(f"{bold('System DB')}    {env['NODE_SYSTEM_SQLITE_PATH']}")
    print(f"{bold('Company DBs')}  {env['NODE_COMPANY_SQLITE_DIR']}")
    print(f"{bold('Public root')}  {env['DEPLOY_PUBLIC_DIR']}")
    print(f"{bold('Releases')}     {env['DEPLOY_BASE_DIR']}")
    print(f"{bold('Backups')}      {env['DEPLOY_BACKUP_DIR']}")
    print("")
    print(cyan("Operations"))
    print(f"{bold('Start')}        systemctl start {env['DEPLOY_SERVICE']}")
    print(f"{bold('Stop')}         systemctl stop {env['DEPLOY_SERVICE']}")
    print(f"{bold('Status')}       python .deploy.py status")
    print(f"{bold('Logs')}         python .deploy.py logs")
    print(f"{bold('Rollback')}     python .deploy.py rollback")
    if cleanup_text:
        print("")
        print(cyan("Cleanup"))
        print(cleanup_text.rstrip())
    if size_text:
        print("")
        print(cyan("Size"))
        print(size_text.rstrip())
    print(cyan("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"))
    print("")


def collect_deploy_report(
    env: dict[str, str],
    *,
    release: str,
    release_fingerprint: str,
    dependency_fingerprint: str,
    deployment_mode: str,
    migration_status: str,
    remote_state: dict[str, str],
) -> str:
    domain = deploy_domain(env)
    sections: list[str] = [
        green(bold("╔" + "═" * 54 + "╗")),
        green(bold("║")) + f" {white(bold('JTZT DEPLOY REPORT')).ljust(52)} " + green(bold("║")),
        green(bold("╚" + "═" * 54 + "╝")),
        "",
    ]

    def add_section(title: str, body: str) -> None:
        sections.append(cyan(bold(f"▶ {title.upper()}")))
        sections.append(body.rstrip())
        sections.append("")

    def yes_no(value: str) -> str:
        return green("yes") if value.lower() in {"active", "enabled", "listening", "healthy"} else yellow(value)

    add_section(
        "summary",
        "\n".join(
            [
                f"{dim('deployment mode:')} {yellow(deployment_mode)}",
                f"{dim('migration status:')} {yellow(migration_status)}",
                f"{dim('release:')} {green(release)}",
                f"{dim('release fingerprint:')} {blue(release_fingerprint)}",
                f"{dim('dependency fingerprint:')} {blue(dependency_fingerprint)}",
                f"{dim('website:')} {yellow(website_url(env))}",
                f"{dim('backend:')} {yellow(backend_url(env))}",
                f"{dim('health:')} {yellow(env['DEPLOY_HEALTH_URL'])}",
            ]
        ),
    )

    remote_state_summary = "\n".join(
        [
            f"{dim('release id:')} {green(str(remote_state.get('release_id', '(none)')))}",
            f"{dim('release fingerprint:')} {blue(str(remote_state.get('release_fingerprint', '(missing)')))}",
            f"{dim('bootstrap hash:')} {blue(str(remote_state.get('bootstrap_hash', '(missing)')))}",
            f"{dim('firewall hash:')} {blue(str(remote_state.get('firewall_hash', '(missing)')))}",
            f"{dim('proxy hash:')} {blue(str(remote_state.get('proxy_hash', '(missing)')))}",
        ]
    )
    add_section("remote state", remote_state_summary)
    add_section(
        "system",
        remote_run(
            env,
            "echo \"$(uname -srm)\" && (command -v node >/dev/null 2>&1 && echo \"node $(node -v)\" || echo \"node missing\") && (command -v npm >/dev/null 2>&1 && echo \"npm $(npm -v)\" || echo \"npm missing\")",
            capture_output=True,
        ).stdout
        or dim("(empty)"),
    )
    add_section(
        "service status",
        remote_run(
            env,
            f"""
set -euo pipefail
active_state="$(systemctl show {env['DEPLOY_SERVICE']} -p ActiveState --value)"
sub_state="$(systemctl show {env['DEPLOY_SERVICE']} -p SubState --value)"
enabled_state="$(systemctl is-enabled {env['DEPLOY_SERVICE']} 2>/dev/null || true)"
main_pid="$(systemctl show {env['DEPLOY_SERVICE']} -p MainPID --value)"
printf 'service: %s (%s)\\n' "$active_state" "$sub_state"
printf 'enabled: %s\\n' "${{enabled_state:-unknown}}"
printf 'main pid: %s\\n' "${{main_pid:-0}}"
if [ -n "{domain}" ]; then
  caddy_state="$(systemctl show caddy -p ActiveState --value)"
  caddy_sub="$(systemctl show caddy -p SubState --value)"
  printf 'proxy: %s (%s)\\n' "${{caddy_state:-unknown}}" "${{caddy_sub:-unknown}}"
fi
""".strip(),
            capture_output=True,
        ).stdout
        or "",
    )
    health_parts = [remote_run(env, f"curl -fsS {env['DEPLOY_HEALTH_URL']} || true", capture_output=True).stdout or ""]
    if domain:
        health_parts.append(remote_run(env, f"curl -fsS --resolve {domain}:443:127.0.0.1 https://{domain}/ || true", capture_output=True).stdout or "")
    add_section("health", "\n".join(part.rstrip() for part in health_parts if part.strip()) or dim("(unavailable)"))
    add_section(
        "listeners",
        remote_run(
            env,
            f"""
set -euo pipefail
ss -lntp | awk '$4 ~ /:3000$/ || $4 ~ /:80$/ || $4 ~ /:443$/' || true
""".strip(),
            capture_output=True,
        ).stdout
        or dim("(no matching listeners)"),
    )
    add_section(
        "firewall",
        remote_run(
            env,
            """
set -euo pipefail
if command -v ufw >/dev/null 2>&1; then
  ufw status verbose || true
else
  echo "ufw not installed"
fi
""".strip(),
            capture_output=True,
        ).stdout
        or dim("(empty)"),
    )
    add_section(
        "paths",
        remote_run(
            env,
            f"""
set -euo pipefail
printf 'base: %s\\n' "{env['DEPLOY_BASE_DIR']}"
printf 'current: %s\\n' "$(readlink -f {env['DEPLOY_BASE_DIR']}/current 2>/dev/null || echo missing)"
printf 'previous: %s\\n' "$(readlink -f {env['DEPLOY_BASE_DIR']}/previous 2>/dev/null || echo missing)"
""".strip(),
            capture_output=True,
        ).stdout
        or dim("(empty)"),
    )
    add_section(
        "storage",
        remote_run(
            env,
            f"""
set -euo pipefail
for path in {env['DEPLOY_BASE_DIR']} {env['DEPLOY_SHARED_DIR']} {env['DEPLOY_BACKUP_DIR']} {env['DEPLOY_PUBLIC_DIR']}; do
  if [ -e "$path" ]; then
    size="$(du -sh "$path" 2>/dev/null | awk '{{print $1}}')"
    printf '%s: %s\\n' "$path" "${{size:-unknown}}"
  fi
done
""".strip(),
            capture_output=True,
        ).stdout
        or dim("(empty)"),
    )
    add_section(
        "releases",
        remote_run(
            env,
            f"""
set -euo pipefail
if [ -d {env['DEPLOY_BASE_DIR']}/releases ]; then
  for path in {env['DEPLOY_BASE_DIR']}/releases/*; do
    [ -e "$path" ] || continue
    size="$(du -sh "$path" 2>/dev/null | awk '{{print $1}}')"
    name="$(basename "$path")"
    printf '%s: %s\\n' "$name" "${{size:-unknown}}"
  done | sort
fi
""".strip(),
            capture_output=True,
        ).stdout
        or dim("(empty)"),
    )
    add_section(
        "backups",
        remote_run(
            env,
            f"""
set -euo pipefail
if [ -d {env['DEPLOY_BACKUP_DIR']} ]; then
  for path in {env['DEPLOY_BACKUP_DIR']}/*; do
    [ -e "$path" ] || continue
    size="$(du -sh "$path" 2>/dev/null | awk '{{print $1}}')"
    name="$(basename "$path")"
    printf '%s: %s\\n' "$name" "${{size:-unknown}}"
  done | sort
fi
""".strip(),
            capture_output=True,
        ).stdout
        or "",
    )
    add_section(
        "databases",
        remote_run(
            env,
            f"""
set -euo pipefail
if [ -f {env['NODE_SYSTEM_SQLITE_PATH']} ]; then
  size="$(du -h {env['NODE_SYSTEM_SQLITE_PATH']} 2>/dev/null | awk '{{print $1}}')"
  printf 'system db: %s (%s)\\n' "{env['NODE_SYSTEM_SQLITE_PATH']}" "${{size:-unknown}}"
fi
if [ -d {env['NODE_COMPANY_SQLITE_DIR']} ]; then
  for path in {env['NODE_COMPANY_SQLITE_DIR']}/*.sqlite; do
    [ -e "$path" ] || continue
    size="$(du -h "$path" 2>/dev/null | awk '{{print $1}}')"
    printf '%s: %s\\n' "$path" "${{size:-unknown}}"
  done
fi
""".strip(),
            capture_output=True,
        ).stdout
        or dim("(empty)"),
    )
    add_section(
        "public root",
        remote_run(
            env,
            f"""
set -euo pipefail
if [ -d {env['DEPLOY_PUBLIC_DIR']} ]; then
  for path in {env['DEPLOY_PUBLIC_DIR']}/*; do
    [ -e "$path" ] || continue
    name="$(basename "$path")"
    if [ -d "$path" ]; then
      printf '%s/\\n' "$name"
    else
      size="$(du -h "$path" 2>/dev/null | awk '{{print $1}}')"
      printf '%s (%s)\\n' "$name" "${{size:-unknown}}"
    fi
  done | sort
fi
""".strip(),
            capture_output=True,
        ).stdout
        or dim("(empty)"),
    )
    sections.append(render_disk_health_section(env).rstrip())
    sections.append(render_ram_health_section(env).rstrip())
    sections.append(green(bold("╔" + "═" * 54 + "╗")))
    sections.append(green(bold("║")) + f" {white(bold('END OF REPORT')).ljust(52)} " + green(bold("║")))
    sections.append(green(bold("╚" + "═" * 54 + "╝")))

    return "\n".join(sections).rstrip() + "\n"


def format_bytes(value: int) -> str:
    units = ["B", "KB", "MB", "GB", "TB", "PB"]
    size = float(max(value, 0))
    unit = 0
    while size >= 1024 and unit < len(units) - 1:
        size /= 1024
        unit += 1
    if unit == 0:
        return f"{int(size)} {units[unit]}"
    return f"{size:.1f} {units[unit]}"


def render_usage_bar(percent: int, width: int = 24) -> str:
    bounded = max(0, min(percent, 100))
    filled = round(width * bounded / 100)
    bar = f"[{'#' * filled}{'-' * (width - filled)}] {bounded:3d}%"
    if bounded >= 90:
        return red(bar)
    if bounded >= 70:
        return yellow(bar)
    return green(bar)


def collect_disk_health(env: dict[str, str]) -> list[dict[str, str | int]]:
    paths = [
        "/",
        env["DEPLOY_BASE_DIR"],
        env["DEPLOY_SHARED_DIR"],
        env["DEPLOY_BACKUP_DIR"],
        env["DEPLOY_PUBLIC_DIR"],
        env["NODE_SYSTEM_SQLITE_PATH"],
    ]
    result = remote_run(
        env,
        "df -P -B1 " + " ".join(shlex.quote(path) for path in paths),
        capture_output=True,
    )
    rows: list[dict[str, str | int]] = []
    lines = [line.strip() for line in (result.stdout or "").splitlines() if line.strip()]
    for line in lines[1:]:
        parts = line.split()
        if len(parts) < 6:
            continue
        filesystem = parts[0]
        total = int(parts[1])
        used = int(parts[2])
        available = int(parts[3])
        used_percent = int(parts[4].rstrip("%"))
        mounted_on = " ".join(parts[5:])
        rows.append({
            "filesystem": filesystem,
            "total": total,
            "used": used,
            "available": available,
            "used_percent": used_percent,
            "mounted_on": mounted_on,
        })
    return rows


def render_disk_health_section(env: dict[str, str]) -> str:
    rows = collect_disk_health(env)
    if not rows:
        return f"{cyan(bold('▶ DISK'))}\n{dim('(missing)')}\n"

    lines = [cyan(bold("▶ DISK")), ""]
    seen_mounts: set[str] = set()
    for row in rows:
        percent = int(row["used_percent"])
        mount = str(row["mounted_on"])
        if mount in seen_mounts:
            continue
        seen_mounts.add(mount)
        lines.append(cyan(bold(mount)))
        lines.append(f"  {render_usage_bar(percent)}")
        lines.append(
            f"  {dim('used')} {white(format_bytes(int(row['used'])))} / {white(format_bytes(int(row['total'])))}"
            f", {dim('free')} {white(format_bytes(int(row['available'])))}"
            f", {dim('filesystem')} {magenta(str(row['filesystem']))}"
        )
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def collect_ram_health(env: dict[str, str]) -> dict[str, int]:
    result = remote_run(
        env,
        r"""
set -euo pipefail
free -b
""".strip(),
        capture_output=True,
    )
    lines = [line.strip() for line in (result.stdout or "").splitlines() if line.strip()]
    mem: dict[str, int] = {}
    swap: dict[str, int] = {}
    for line in lines:
        parts = line.split()
        if len(parts) < 7:
            continue
        label = parts[0].rstrip(":").lower()
        values = {
            "total": int(parts[1]),
            "used": int(parts[2]),
            "free": int(parts[3]),
            "shared": int(parts[4]),
            "buff_cache": int(parts[5]),
            "available": int(parts[6]),
        }
        if label == "mem":
            mem = values
        elif label == "swap":
            swap = values
    return {
        "mem_total": mem.get("total", 0),
        "mem_used": mem.get("used", 0),
        "mem_free": mem.get("free", 0),
        "mem_shared": mem.get("shared", 0),
        "mem_buff_cache": mem.get("buff_cache", 0),
        "mem_available": mem.get("available", 0),
        "swap_total": swap.get("total", 0),
        "swap_used": swap.get("used", 0),
        "swap_free": swap.get("free", 0),
    }


def render_ram_health_section(env: dict[str, str]) -> str:
    stats = collect_ram_health(env)
    if not stats["mem_total"]:
        return f"{cyan(bold('▶ RAM'))}\n{dim('(missing)')}\n"

    mem_percent = round(100 * stats["mem_used"] / stats["mem_total"]) if stats["mem_total"] else 0
    swap_percent = round(100 * stats["swap_used"] / stats["swap_total"]) if stats["swap_total"] else 0
    lines = [cyan(bold("▶ RAM")), ""]
    lines.append(cyan(bold("memory")))
    lines.append(f"  {render_usage_bar(mem_percent)}")
    lines.append(
        f"  {dim('used')} {white(format_bytes(stats['mem_used']))} / {white(format_bytes(stats['mem_total']))}"
        f", {dim('free')} {white(format_bytes(stats['mem_free']))}"
        f", {dim('available')} {white(format_bytes(stats['mem_available']))}"
        f", {dim('cached')} {white(format_bytes(stats['mem_buff_cache']))}"
    )
    lines.append("")
    lines.append(cyan(bold("swap")))
    lines.append(f"  {render_usage_bar(swap_percent)}")
    lines.append(
        f"  {dim('used')} {white(format_bytes(stats['swap_used']))} / {white(format_bytes(stats['swap_total']))}"
        f", {dim('free')} {white(format_bytes(stats['swap_free']))}"
    )
    lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def print_size_report(env: dict[str, str], release: str | None = None, *, remote_text: str | None = None) -> None:
    print("")
    print(green(bold("JTZT SIZE REPORT")))
    print(cyan("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"))
    if release:
        print(f"{bold('Release')}      {release}")
    print(f"{bold('System DB')}    {env['NODE_SYSTEM_SQLITE_PATH']}")
    print(f"{bold('Company DBs')}  {env['NODE_COMPANY_SQLITE_DIR']}")
    print(f"{bold('Releases')}     {env['DEPLOY_BASE_DIR']}")
    print(f"{bold('Backups')}      {env['DEPLOY_BACKUP_DIR']}")
    print(f"{bold('Public root')}  {env['DEPLOY_PUBLIC_DIR']}")
    print("")
    if remote_text:
        print(remote_text.rstrip())
        print("")
    print(cyan("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"))
    print("")


def print_cleanup_report(env: dict[str, str], release: str | None = None, *, remote_text: str | None = None) -> None:
    print("")
    print(green(bold("JTZT CLEANUP REPORT")))
    print(cyan("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"))
    if release:
        print(f"{bold('Release')}      {release}")
    print(f"{bold('Keep')}         3")
    print(f"{bold('Releases')}     {env['DEPLOY_BASE_DIR']}/releases")
    print(f"{bold('Backups')}      {env['DEPLOY_BACKUP_DIR']}")
    print("")
    if remote_text:
        print(remote_text.rstrip())
        print("")
    print(cyan("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"))
    print("")


def print_migration_report(env: dict[str, str], release: str | None = None, *, remote_text: str | None = None) -> None:
    print("")
    print(green(bold("JTZT MIGRATION REPORT")))
    print(cyan("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"))
    if release:
        print(f"{bold('Release')}      {release}")
    print(f"{bold('System DB')}    {env['NODE_SYSTEM_SQLITE_PATH']}")
    print(f"{bold('Company DBs')}  {env['NODE_COMPANY_SQLITE_DIR']}")
    print(f"{bold('Backups')}      {env['DEPLOY_BACKUP_DIR']}")
    print("")
    if remote_text:
        print(remote_text.rstrip())
        print("")
    print(cyan("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"))
    print("")


def summarize_remote_firewall(env: dict[str, str]) -> None:
    remote_run(
        env,
        """
set -euo pipefail
if command -v ufw >/dev/null 2>&1; then
  ufw status verbose || true
else
  echo "ufw not installed"
fi
ss -lntp || true
""".strip(),
    )


def release_paths() -> list[Path]:
    return [
        ROOT / "dist" / "backend",
        ROOT / "dist" / "frontend",
        ROOT / "backend" / "db" / "migrations" / "system",
        ROOT / "backend" / "db" / "migrations" / "company",
        ROOT / "package.json",
        ROOT / "package-lock.json",
    ]


def build_release_archive(release: str) -> Path:
    archive_path = Path(tempfile.gettempdir()) / f"jtzt-release-{release}.tar.gz"
    if archive_path.exists():
        archive_path.unlink()

    with tarfile.open(archive_path, "w:gz") as archive:
        for item in release_paths():
            if not item.exists():
                fail(f"missing release artifact: {item}")
            if item.is_dir():
                archive.add(item, arcname=item.relative_to(ROOT))
            else:
                archive.add(item, arcname=item.relative_to(ROOT))

    return archive_path


def print_layout() -> None:
    print("")
    print("=== REMOTE FILESYSTEM LAYOUT ===")
    print("/opt/jtzt/releases/<release_id>")
    print("/opt/jtzt/current -> /opt/jtzt/releases/<release_id>")
    print("/opt/jtzt/previous -> /opt/jtzt/releases/<release_id>")
    print("/var/lib/jtzt/system.db")
    print("/var/lib/jtzt/companies/*.sqlite")
    print("/var/lib/jtzt/public/")
    print("/etc/jtzt/jtzt.env")
    print("/etc/caddy/Caddyfile")
    print("/var/backups/jtzt/<release_id>/")
    print("================================")
    print("")


def print_command_plan() -> None:
    print("")
    print("=== COMMAND PLAN (REMOTE) ===")
    print("mkdir -p /opt/jtzt/releases /var/lib/jtzt/companies /var/lib/jtzt/public /var/backups/jtzt /etc/jtzt")
    print("install Caddy and write /etc/caddy/Caddyfile when DEPLOY_DOMAIN is set")
    print("systemctl daemon-reload")
    print("systemctl enable jtzt")
    print("systemctl enable caddy")
    print("systemctl stop jtzt")
    print("cp -a /var/lib/jtzt/. /var/backups/jtzt/<release_id>/")
    print("node <release>/dist/backend/server.js migrate")
    print("ln -sfn /opt/jtzt/releases/<release_id> /opt/jtzt/current")
    print("systemctl start jtzt")
    print("systemctl restart caddy")
    print("wait for health with retries")
    print("=============================")
    print("")


def doctor(env: dict[str, str]) -> None:
    ensure_local_tools()
    validate_env(env)
    remote_run(env, "true")
    ensure_remote_prereqs(env)
    ensure_remote_firewall(env)
    ensure_remote_web_proxy(env)
    remote_run(env, "command -v node >/dev/null")
    remote_run(env, "command -v npm >/dev/null")
    remote_run(env, "command -v tar >/dev/null")
    remote_run(env, "command -v systemctl >/dev/null")
    remote_run(env, "command -v curl >/dev/null")
    summarize_remote_firewall(env)
    print_layout()
    print_command_plan()
    info(f"deploy target: {env['DEPLOY_USER']}@{env['DEPLOY_HOST']}:{env['DEPLOY_PORT']}")


def bootstrap(env: dict[str, str]) -> None:
    ensure_local_tools()
    env = build_release_env(env, allow_generate=True)
    ensure_remote_prereqs(env)
    ensure_remote_firewall(env)
    ensure_remote_web_proxy(env)
    remote_run(
        env,
        "mkdir -p {base}/releases {shared}/companies {backup} /etc/jtzt".format(
            base=env["DEPLOY_BASE_DIR"],
            shared=env["DEPLOY_SHARED_DIR"],
            backup=env["DEPLOY_BACKUP_DIR"],
        ),
    )
    remote_run(env, "mkdir -p {public}".format(public=env["DEPLOY_PUBLIC_DIR"]))

    service_unit = render_systemd_unit(env)
    service_changed = remote_write_text_if_changed(
        env,
        f"/etc/systemd/system/{env['DEPLOY_SERVICE']}.service",
        service_unit,
    )
    env_changed = remote_write_text_if_changed(env, env["DEPLOY_ENV_PATH"], render_runtime_env(env))
    if service_changed or env_changed:
        remote_run(env, "systemctl daemon-reload")
    remote_run(env, f"systemctl enable {env['DEPLOY_SERVICE']}")
    if deploy_domain(env):
        remote_run(env, "systemctl enable caddy")
    write_remote_deploy_state(env, build_bootstrap_state(env))
    info("bootstrap complete")


def upload_release(env: dict[str, str], release: str) -> str:
    release_dir = f"{env['DEPLOY_BASE_DIR']}/releases/{release}"
    archive_path = build_release_archive(release)
    try:
        with archive_path.open("rb") as archive_file:
            command = ssh_base_args(env) + [remote_target(env), f"mkdir -p {release_dir} && tar -xzf - -C {release_dir}"]
            info("running: " + " ".join(command))
            subprocess.run(
                command,
                cwd=str(ROOT),
                check=True,
                stdin=archive_file,
                text=False,
                env=os.environ.copy(),
            )
    finally:
        if archive_path.exists():
            archive_path.unlink()
    return release_dir


def resolve_current_release(env: dict[str, str]) -> tuple[str, str]:
    result = remote_run(env, f"readlink -f {env['DEPLOY_BASE_DIR']}/current", capture_output=True)
    release_dir = (result.stdout or "").strip()
    if not release_dir:
        fail("could not resolve current release on the remote host")
    release = Path(release_dir).name
    return release, release_dir


def run_release_migrations(env: dict[str, str], release: str, release_dir: str, *, emit: bool = True) -> str | None:
    result = remote_run(
        env,
        f"""
set -euo pipefail
lock_dir=/var/lock/jtzt-deploy.lock
if ! mkdir "$lock_dir" 2>/dev/null; then
  echo "deploy already in progress" >&2
  exit 1
fi
trap 'rmdir "$lock_dir"' EXIT INT TERM
systemctl stop {env['DEPLOY_SERVICE']}
systemctl reset-failed {env['DEPLOY_SERVICE']} || true
mkdir -p {env['DEPLOY_BACKUP_DIR']}/{release}
cp -a {env['DEPLOY_SHARED_DIR']}/. {env['DEPLOY_BACKUP_DIR']}/{release}/
cd {release_dir}
set -a
. {env['DEPLOY_ENV_PATH']}
set +a
node dist/backend/server.js migrate
""".strip(),
        capture_output=True,
    )
    if emit and result.stdout:
        print_migration_report(env, release=release, remote_text=result.stdout)
    if result.stderr:
        print(result.stderr, file=sys.stderr)
    return result.stdout or ""


def install_remote_deps(env: dict[str, str], release_dir: str, dependency_fingerprint: str) -> None:
    remote_run(
        env,
        f"""
set -euo pipefail
cache_root={REMOTE_NPM_CACHE_DIR}
release_dir={release_dir}
node_identity="$(node -p 'process.platform + "-" + process.arch + "-" + process.versions.node')"
cache_dir="$cache_root/{dependency_fingerprint}/$node_identity"
if [ -d "$cache_dir/node_modules" ]; then
  rm -rf "$release_dir/node_modules"
  ln -sfn "$cache_dir/node_modules" "$release_dir/node_modules"
  exit 0
fi

mkdir -p "$cache_dir"
cp "$release_dir/package.json" "$cache_dir/package.json"
cp "$release_dir/package-lock.json" "$cache_dir/package-lock.json"
cd "$cache_dir"
npm ci --omit=dev --no-audit --no-fund
rm -rf "$release_dir/node_modules"
ln -sfn "$cache_dir/node_modules" "$release_dir/node_modules"
""".strip(),
    )


def wait_for_remote_health(env: dict[str, str], *, extra_context: str = "") -> None:
    remote_run(
        env,
        f"""
set -euo pipefail
show_state() {{
  echo "== systemctl show ==" >&2
  systemctl show {env['DEPLOY_SERVICE']} -p ActiveState -p SubState -p Result -p MainPID -p ExecMainCode -p ExecMainStatus -p NRestarts --no-pager || true
  echo "== listeners ==" >&2
  ss -lntp || true
}}
for attempt in $(seq 1 60); do
  echo "waiting for health: attempt $attempt/60" >&2
  if systemctl is-active --quiet {env['DEPLOY_SERVICE']}; then
    if curl -fsS {env['DEPLOY_HEALTH_URL']} >/dev/null; then
      exit 0
    fi
  fi
  if [ $((attempt % 5)) -eq 0 ]; then
    show_state
  fi
  sleep 2
done
echo "health check timed out after 120 seconds" >&2
systemctl status {env['DEPLOY_SERVICE']} --no-pager || true
journalctl -u {env['DEPLOY_SERVICE']} -n 200 --no-pager || true
show_state
if command -v ufw >/dev/null 2>&1; then
  ufw status verbose || true
fi
{extra_context}
exit 1
""",
    )


def wait_for_public_website(env: dict[str, str], *, extra_context: str = "") -> None:
    domain = deploy_domain(env)
    if not domain:
        return
    remote_run(
        env,
        f"""
set -euo pipefail
for attempt in $(seq 1 60); do
  echo "waiting for public website: attempt $attempt/60" >&2
  if systemctl is-active --quiet caddy; then
    if curl -fsS --resolve {domain}:443:127.0.0.1 https://{domain}/ >/dev/null; then
      exit 0
    fi
  fi
  if [ $((attempt % 5)) -eq 0 ]; then
    systemctl status caddy --no-pager || true
    journalctl -u caddy -n 120 --no-pager || true
  fi
  sleep 2
done
echo "public website check timed out after 120 seconds" >&2
systemctl status caddy --no-pager || true
journalctl -u caddy -n 200 --no-pager || true
{extra_context}
exit 1
""".strip(),
    )


def ensure_remote_prereqs(env: dict[str, str]) -> None:
    remote_run(
        env,
        """
set -euo pipefail
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1 || ! command -v tar >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y nodejs npm tar curl ca-certificates build-essential python3 make g++
fi
""".strip(),
    )


def ensure_remote_firewall(env: dict[str, str]) -> None:
    desired_hash = sha256_text(json.dumps({
        "ports": [22, 80, 443, 3000],
        "enabled": True,
    }, sort_keys=True, separators=(",", ":")))
    state = read_remote_deploy_state(env)
    if state.get("firewall_hash") == desired_hash:
        return

    remote_run(
        env,
        """
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
if ! command -v ufw >/dev/null 2>&1; then
  apt-get update
  apt-get install -y ufw
fi
ufw allow 22/tcp >/dev/null || true
ufw allow 80/tcp >/dev/null || true
ufw allow 443/tcp >/dev/null || true
ufw allow 3000/tcp >/dev/null || true
ufw --force enable >/dev/null || true
ufw status verbose || true
""".strip(),
    )
    state["firewall_hash"] = desired_hash
    write_remote_deploy_state(env, state)


def ensure_remote_web_proxy(env: dict[str, str]) -> None:
    domain = deploy_domain(env)
    if not domain:
        return
    remote_run(
        env,
        f"""
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
if ! command -v caddy >/dev/null 2>&1; then
  apt-get update
  apt-get install -y caddy
fi
install -d -m 755 /etc/caddy
systemctl enable caddy
""".strip(),
    )
    changed = remote_write_text_if_changed(env, "/etc/caddy/Caddyfile", render_caddyfile(env))
    if not changed:
        return
    remote_run(
        env,
        f"""
set -euo pipefail
if command -v getent >/dev/null 2>&1; then
  resolved="$(getent ahostsv4 {shlex.quote(domain)} | awk 'NR==1 {{print $1}}')"
  if [ -n "$resolved" ] && [ "$resolved" != "{env['DEPLOY_HOST']}" ]; then
    echo "warning: {domain} resolves to $resolved, expected {env['DEPLOY_HOST']}" >&2
  fi
fi
caddy fmt --overwrite /etc/caddy/Caddyfile >/dev/null
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
systemctl restart caddy
""".strip(),
    )


def sync_public_assets(env: dict[str, str], release_dir: str) -> None:
    remote_run(
        env,
        f"""
set -euo pipefail
mkdir -p {env['DEPLOY_PUBLIC_DIR']}
cp -a {release_dir}/dist/frontend/. {env['DEPLOY_PUBLIC_DIR']}/
""".strip(),
    )


def collect_remote_diagnostics(env: dict[str, str], label: str) -> None:
    domain_block = ""
    if deploy_domain(env):
        domain_block = f"""
echo "-- caddy --"
systemctl status caddy --no-pager || true
echo "-- caddy journal --"
journalctl -u caddy -n 120 --no-pager || true
echo "-- caddyfile --"
cat /etc/caddy/Caddyfile || true
"""
    result = remote_run(
        env,
        f"""
set -euo pipefail
echo "=== {label} ==="
echo "-- uname --"
uname -a || true
echo "-- listeners --"
ss -lntp || true
echo "-- firewall --"
if command -v ufw >/dev/null 2>&1; then
  ufw status verbose || true
else
  echo "ufw not installed"
fi
echo "-- service --"
systemctl status {env['DEPLOY_SERVICE']} --no-pager || true
echo "-- journal --"
journalctl -u {env['DEPLOY_SERVICE']} -n 200 --no-pager || true
{domain_block}
echo "-- symlink --"
ls -la {env['DEPLOY_BASE_DIR']} || true
readlink -f {env['DEPLOY_BASE_DIR']}/current || true
echo "-- public root --"
ls -la {env['DEPLOY_PUBLIC_DIR']} || true
echo "-- local health --"
curl -fsS {env['DEPLOY_HEALTH_URL']} || true
""",
        capture_output=True,
    )
    if result.stdout:
        print(result.stdout)
    if result.stderr:
        print(result.stderr, file=sys.stderr)


def deploy(env: dict[str, str]) -> None:
    ensure_local_tools()
    validate_env(env)
    current_state = read_remote_deploy_state(env)
    if not bootstrap_inputs_match_state(env, current_state):
        info("bootstrap state changed or missing; refreshing server setup")
        bootstrap(env)
        current_state = read_remote_deploy_state(env)
    ensure_remote_prereqs(env)
    ensure_remote_firewall(env)
    ensure_remote_web_proxy(env)
    dependency_fingerprint = hash_dependency_inputs()
    release_fingerprint = hash_release_inputs()
    if current_state.get("release_fingerprint") == release_fingerprint:
        release_label = current_state.get("release_id") or release_fingerprint[:12]
        domain = deploy_domain(env)
        website_probe = "true"
        if domain:
            website_probe = f"curl -fsS --resolve {domain}:443:127.0.0.1 https://{domain}/ >/dev/null"
        health_result = remote_run(
            env,
            f"""
set -euo pipefail
if systemctl is-active --quiet {env['DEPLOY_SERVICE']} && curl -fsS {env['DEPLOY_HEALTH_URL']} >/dev/null && {website_probe}; then
  echo "healthy"
else
  echo "restart-needed"
fi
""".strip(),
            capture_output=True,
        )
        if (health_result.stdout or "").strip() == "healthy":
            info("remote release fingerprint already matches the current build and the service is healthy; skipping deploy")
            final_report = collect_deploy_report(
                env,
                release=release_label,
                release_fingerprint=release_fingerprint,
                dependency_fingerprint=dependency_fingerprint,
                deployment_mode="no-op",
                migration_status="not run",
                remote_state=current_state,
            )
            print(final_report.rstrip())
            return

        info("remote release fingerprint already matches the current build, but the service needs a restart")
        remote_run(
            env,
            f"""
set -euo pipefail
systemctl start {env['DEPLOY_SERVICE']}
""".strip(),
        )
        wait_for_remote_health(env)
        wait_for_public_website(env)
        updated_state = read_remote_deploy_state(env)
        final_report = collect_deploy_report(
            env,
            release=release_label,
            release_fingerprint=release_fingerprint,
            dependency_fingerprint=dependency_fingerprint,
            deployment_mode="restart-only",
            migration_status="not run",
            remote_state=updated_state or current_state,
        )
        print(final_report.rstrip())
        return

    release = release_id(release_fingerprint)
    release_dir = upload_release(env, release)
    install_remote_deps(env, release_dir, dependency_fingerprint)
    sync_public_assets(env, release_dir)
    try:
        run_release_migrations(env, release, release_dir, emit=False)
        remote_run(
            env,
            f"""
set -euo pipefail
base={env['DEPLOY_BASE_DIR']}
if [ -L "$base/current" ]; then
  ln -sfn "$(readlink "$base/current")" "$base/previous"
fi
ln -sfn {release_dir} "$base/current"
systemctl start {env['DEPLOY_SERVICE']}
""".strip(),
        )
        wait_for_remote_health(env)
        wait_for_public_website(env)
        remote_state = build_deploy_state(
            env,
            release_fingerprint=release_fingerprint,
            release_id=release,
        )
        write_remote_deploy_state(env, remote_state)
        cleanup_text = prune_releases(env, keep=3, emit=False)
        remote_state["cleanup"] = cleanup_text or ""
        final_report = collect_deploy_report(
            env,
            release=release,
            release_fingerprint=release_fingerprint,
            dependency_fingerprint=dependency_fingerprint,
            deployment_mode="deployed",
            migration_status="success",
            remote_state=remote_state,
        )
        print(final_report.rstrip())
    except Exception:
        info("deploy failed, attempting rollback")
        try:
            collect_remote_diagnostics(env, "DEPLOY FAILURE DIAGNOSTICS")
        except Exception as diagnostic_error:
            info(f"diagnostics collection failed: {diagnostic_error}")
        try:
            rollback(env)
        except Exception:
            info("rollback failed; manual intervention required")
        raise


def migrate(env: dict[str, str]) -> None:
    ensure_local_tools()
    validate_env(env)
    ensure_remote_prereqs(env)
    ensure_remote_firewall(env)
    release, release_dir = resolve_current_release(env)
    try:
        run_release_migrations(env, release, release_dir)
        remote_run(env, f"systemctl start {env['DEPLOY_SERVICE']}")
        wait_for_remote_health(env)
        wait_for_public_website(env)
        info(f"migration complete: {release}")
    except Exception:
        info("migration failed")
        try:
            collect_remote_diagnostics(env, "MIGRATION FAILURE DIAGNOSTICS")
        except Exception as diagnostic_error:
            info(f"diagnostics collection failed: {diagnostic_error}")
        try:
            rollback(env)
        except Exception:
            info("rollback after migration failure failed; manual intervention required")
        raise


def status(env: dict[str, str]) -> None:
    remote_run(env, f"systemctl status {env['DEPLOY_SERVICE']} --no-pager")
    if deploy_domain(env):
        remote_run(env, "systemctl status caddy --no-pager || true")
    remote_run(env, f"ls -la {env['DEPLOY_BASE_DIR']} | sed -n '1,200p'")


def rollback(env: dict[str, str]) -> None:
    base = env["DEPLOY_BASE_DIR"]
    try:
        remote_run(
            env,
            f"""
set -euo pipefail
if [ ! -L {base}/previous ]; then
  echo "no previous release" >&2
  exit 2
fi
systemctl stop {env['DEPLOY_SERVICE']}
systemctl reset-failed {env['DEPLOY_SERVICE']} || true
ln -sfn "$(readlink {base}/previous)" {base}/current
systemctl start {env['DEPLOY_SERVICE']}
""",
        )
        wait_for_remote_health(env, extra_context="echo 'rollback health check failed' >&2")
        wait_for_public_website(env, extra_context="echo 'rollback public website check failed' >&2")
    except subprocess.CalledProcessError as exc:
        stderr = (exc.stderr or "").strip()
        if "no previous release" in stderr:
            info("no previous release available; leaving current service state unchanged")
            return
        raise
    info("rollback complete")


def logs(env: dict[str, str]) -> None:
    remote_run(env, f"journalctl -u {env['DEPLOY_SERVICE']} -n 200 --no-pager")


def size_report(env: dict[str, str], release: str | None = None, *, emit: bool = True) -> str | None:
    ensure_local_tools()
    validate_env(env)
    result = remote_run(
        env,
        f"""
set -euo pipefail
echo "== filesystem =="
du -sh {env['DEPLOY_BASE_DIR']} {env['DEPLOY_SHARED_DIR']} {env['DEPLOY_BACKUP_DIR']} 2>/dev/null || true
echo ""
echo "== releases =="
if [ -d {env['DEPLOY_BASE_DIR']}/releases ]; then
  du -sh {env['DEPLOY_BASE_DIR']}/releases/* 2>/dev/null | sort -h || true
fi
echo ""
echo "== database files =="
if [ -f {env['NODE_SYSTEM_SQLITE_PATH']} ]; then
  ls -lh {env['NODE_SYSTEM_SQLITE_PATH']}
fi
if [ -d {env['NODE_COMPANY_SQLITE_DIR']} ]; then
  ls -lh {env['NODE_COMPANY_SQLITE_DIR']}/*.sqlite 2>/dev/null || true
fi
echo ""
echo "== current symlink =="
readlink -f {env['DEPLOY_BASE_DIR']}/current || true
echo "== previous symlink =="
readlink -f {env['DEPLOY_BASE_DIR']}/previous || true
""".strip(),
        capture_output=True,
    )
    if emit and result.stdout:
        print_size_report(env, release=release, remote_text=result.stdout)
    if result.stderr:
        print(result.stderr, file=sys.stderr)
    return result.stdout or ""


def prune_releases(env: dict[str, str], keep: int = 3, *, emit: bool = True) -> str | None:
    ensure_local_tools()
    validate_env(env)
    if keep < 1:
        fail("keep must be at least 1")

    result = remote_run(
        env,
        f"""
set -euo pipefail
releases_dir={env['DEPLOY_BASE_DIR']}/releases
backups_dir={env['DEPLOY_BACKUP_DIR']}
current_target="$(readlink -f {env['DEPLOY_BASE_DIR']}/current 2>/dev/null || true)"
previous_target="$(readlink -f {env['DEPLOY_BASE_DIR']}/previous 2>/dev/null || true)"

echo "== release cleanup =="
if [ -d "$releases_dir" ]; then
  mapfile -t releases < <(find "$releases_dir" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort)
  echo "before: ${{#releases[@]}}"
  kept_releases=()
  removed_releases=()
  if [ "${{#releases[@]}}" -gt {keep} ]; then
    delete_count=$(( ${{#releases[@]}} - {keep} ))
    for ((i=0; i<delete_count; i++)); do
      release="${{releases[$i]}}"
      target="$releases_dir/$release"
      target_real="$(readlink -f "$target" 2>/dev/null || true)"
      if [ "$target_real" = "$current_target" ] || [ "$target_real" = "$previous_target" ]; then
        kept_releases+=("$release")
        continue
      fi
      rm -rf "$target"
      removed_releases+=("$release")
    done
  fi
  mapfile -t releases_after < <(find "$releases_dir" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort)
  echo "after: ${{#releases_after[@]}}"
  echo "kept:"
  for release in "${{releases_after[@]}}"; do
    echo "  - $release"
  done
  echo "removed:"
  if [ "${{#removed_releases[@]}}" -eq 0 ]; then
    echo "  - (none)"
  else
    for release in "${{removed_releases[@]}}"; do
      echo "  - $release"
    done
  fi
else
  echo "before: 0"
  echo "after: 0"
  echo "kept:"
  echo "  - (none)"
  echo "removed:"
  echo "  - (none)"
fi

echo ""
echo "== backup cleanup =="
if [ -d "$backups_dir" ]; then
  mapfile -t backups < <(find "$backups_dir" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort)
  echo "before: ${{#backups[@]}}"
  removed_backups=()
  if [ "${{#backups[@]}}" -gt {keep} ]; then
    delete_count=$(( ${{#backups[@]}} - {keep} ))
    for ((i=0; i<delete_count; i++)); do
      backup="${{backups[$i]}}"
      rm -rf "$backups_dir/$backup"
      removed_backups+=("$backup")
    done
  fi
  mapfile -t backups_after < <(find "$backups_dir" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort)
  echo "after: ${{#backups_after[@]}}"
  echo "kept:"
  for backup in "${{backups_after[@]}}"; do
    echo "  - $backup"
  done
  echo "removed:"
  if [ "${{#removed_backups[@]}}" -eq 0 ]; then
    echo "  - (none)"
  else
    for backup in "${{removed_backups[@]}}"; do
      echo "  - $backup"
    done
  fi
else
  echo "before: 0"
  echo "after: 0"
  echo "kept:"
  echo "  - (none)"
  echo "removed:"
  echo "  - (none)"
fi
""".strip(),
        capture_output=True,
    )
    if emit and result.stdout:
        print_cleanup_report(env, remote_text=result.stdout)
    if result.stderr:
        print(result.stderr, file=sys.stderr)
    return result.stdout or ""


def diagnose(env: dict[str, str]) -> None:
    ensure_local_tools()
    validate_env(env)
    ensure_remote_prereqs(env)
    ensure_remote_firewall(env)
    collect_remote_diagnostics(env, "MANUAL DIAGNOSTICS")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Jtzt Hetzner deployment helper")
    parser.add_argument(
        "command",
        choices=["doctor", "bootstrap", "build", "typecheck", "deploy", "migrate", "status", "rollback", "logs", "diagnose", "full", "size-report", "prune-releases"],
        nargs="?",
        default="full",
    )
    parser.add_argument("--keep", type=int, default=3, help="Number of remote releases to keep when pruning")
    return parser.parse_args()


def main() -> None:
    if not shutil.which("npm"):
        fail("npm is required on the local machine")

    args = parse_args()
    env = load_env()

    try:
        if args.command == "doctor":
            doctor(build_release_env(env, allow_generate=False))
            return
        if args.command == "bootstrap":
            bootstrap(env)
            return
        if args.command == "build":
            build_assets()
            return
        if args.command == "typecheck":
            run(["npm", "run", "typecheck"])
            return
        if args.command == "deploy":
            build_assets()
            deploy(build_release_env(env, allow_generate=True))
            return
        if args.command == "migrate":
            migrate(build_release_env(env, allow_generate=False))
            pause_on_success()
            return
        if args.command == "status":
            status(build_release_env(env, allow_generate=False))
            return
        if args.command == "rollback":
            rollback(build_release_env(env, allow_generate=False))
            return
        if args.command == "logs":
            logs(build_release_env(env, allow_generate=False))
            return
        if args.command == "size-report":
            size_report(build_release_env(env, allow_generate=False))
            return
        if args.command == "prune-releases":
            prune_releases(build_release_env(env, allow_generate=False), keep=args.keep)
            return
        if args.command == "diagnose":
            diagnose(build_release_env(env, allow_generate=False))
            return
        if args.command == "full":
            prepared = build_release_env(env, allow_generate=True)
            build_assets()
            deploy(build_release_env(prepared, allow_generate=False))
            return

        fail(f"unsupported command: {args.command}")
    except subprocess.CalledProcessError as exc:
        fail(f"{args.command} failed with exit code {exc.returncode}. Check SSH access, host firewall, DEPLOY_USER, and DEPLOY_KEY_PATH.", exc.returncode)


if __name__ == "__main__":
    main()
