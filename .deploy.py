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
  node /tmp/jtzt-schema-refresh.mjs
  ln -sfn /opt/jtzt/releases/<release_id> /opt/jtzt/current
  systemctl start jtzt
  curl -fsS <health_url>
"""

from __future__ import annotations

import argparse
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


def red(text: str) -> str:
    return color(text, "31")


def fail(message: str, code: int = 1) -> None:
    print(f"[deploy:error] {message}", file=sys.stderr)
    raise SystemExit(code)


def pause_on_success(timeout_seconds: int = 10) -> None:
    if not sys.stdin.isatty() or not sys.stdout.isatty():
        return

    print("")
    print(green(bold("DEPLOY SUCCESS")))
    print(f"Press Enter to close now, or wait {timeout_seconds} seconds to close automatically.")
    print("")
    print(">", end=" ", flush=True)

    deadline = datetime.now().timestamp() + timeout_seconds
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
            if datetime.now().timestamp() >= deadline:
                print("")
                return
            time.sleep(1)
    else:
        remaining = timeout_seconds
        while remaining > 0:
            ready, _, _ = select.select([sys.stdin], [], [], 1)
            if ready:
                sys.stdin.readline()
                print("")
                return
            remaining -= 1
        print("")


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


def build_assets() -> None:
    run(["npm", "run", "typecheck"])
    run(["npm", "run", "build:frontend"])
    run(["npm", "run", "build:backend"])


def release_id() -> str:
    try:
        result = run(["git", "rev-parse", "--short", "HEAD"], capture_output=True)
        sha = (result.stdout or "").strip()
    except Exception:
        sha = "nogit"
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    return f"{stamp}-{sha}"


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


def print_report(env: dict[str, str], release: str | None = None) -> None:
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
    print("node <release>/schema-refresh.mjs")
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

    service_unit = f"""[Unit]
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

    remote_run(
        env,
        "cat > /etc/systemd/system/{service}.service <<'EOF'\n{unit}\nEOF".format(
            service=env["DEPLOY_SERVICE"],
            unit=service_unit.rstrip(),
        ),
    )
    remote_run(env, "cat > {env_path} <<'EOF'\n{contents}EOF".format(
        env_path=env["DEPLOY_ENV_PATH"],
        contents=render_runtime_env(env),
    ))
    remote_run(env, "systemctl daemon-reload")
    remote_run(env, f"systemctl enable {env['DEPLOY_SERVICE']}")
    if deploy_domain(env):
        remote_run(env, "systemctl enable caddy")
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


def install_remote_deps(env: dict[str, str], release_dir: str) -> None:
    remote_run(env, f"cd {release_dir} && npm ci --omit=dev --no-audit --no-fund")


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
cat > /etc/caddy/Caddyfile <<'EOF'
{render_caddyfile(env).rstrip()}
EOF
if command -v getent >/dev/null 2>&1; then
  resolved="$(getent ahostsv4 {shlex.quote(domain)} | awk 'NR==1 {{print $1}}')"
  if [ -n "$resolved" ] && [ "$resolved" != "{env['DEPLOY_HOST']}" ]; then
    echo "warning: {domain} resolves to $resolved, expected {env['DEPLOY_HOST']}" >&2
  fi
fi
caddy fmt --overwrite /etc/caddy/Caddyfile >/dev/null
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
systemctl enable caddy
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
    ensure_remote_prereqs(env)
    ensure_remote_firewall(env)
    ensure_remote_web_proxy(env)
    release = release_id()
    release_dir = upload_release(env, release)
    install_remote_deps(env, release_dir)
    sync_public_assets(env, release_dir)
    try:
        deploy_script = f"""
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
cat > {release_dir}/schema-refresh.mjs <<'EOF'
import path from 'node:path';
import Database from 'better-sqlite3';
import {{ systemSchema, companySchema }} from './dist/backend/db/schema.js';

const systemPath = process.env.NODE_SYSTEM_SQLITE_PATH || '/var/lib/jtzt/system.db';
const companyDir = process.env.NODE_COMPANY_SQLITE_DIR || '/var/lib/jtzt/companies';

const systemDb = new Database(systemPath);
systemDb.exec(systemSchema);
const rows = systemDb.prepare('SELECT id FROM companies').all();
systemDb.close();

for (const row of rows) {{
  const dbPath = path.join(companyDir, `${{row.id}}.sqlite`);
  const db = new Database(dbPath);
  db.exec(companySchema);
  db.close();
}}
EOF
node {release_dir}/schema-refresh.mjs
rm -f {release_dir}/schema-refresh.mjs
base={env['DEPLOY_BASE_DIR']}
if [ -L "$base/current" ]; then
  ln -sfn "$(readlink "$base/current")" "$base/previous"
fi
ln -sfn {release_dir} "$base/current"
systemctl start {env['DEPLOY_SERVICE']}
"""
        remote_run(env, deploy_script)
        wait_for_remote_health(env)
        wait_for_public_website(env)
        info(f"deploy complete: {release}")
        print_report(env, release)
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
        choices=["doctor", "bootstrap", "build", "typecheck", "deploy", "status", "rollback", "logs", "diagnose", "full"],
        nargs="?",
        default="full",
    )
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
            deploy(build_release_env(env, allow_generate=False))
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
        if args.command == "diagnose":
            diagnose(build_release_env(env, allow_generate=False))
            return
        if args.command == "full":
            prepared = build_release_env(env, allow_generate=True)
            doctor(prepared)
            bootstrap(prepared)
            build_assets()
            deploy(build_release_env(prepared, allow_generate=False))
            pause_on_success()
            return

        fail(f"unsupported command: {args.command}")
    except subprocess.CalledProcessError as exc:
        fail(f"{args.command} failed with exit code {exc.returncode}. Check SSH access, host firewall, DEPLOY_USER, and DEPLOY_KEY_PATH.", exc.returncode)


if __name__ == "__main__":
    main()
