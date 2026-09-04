#!/usr/bin/env bash
#
# Bootstrap the General Store on an Oracle Cloud Always Free VM.
#
# Requirements:
#   - Ubuntu 22.04/24.04 (ARM Ampere or x86), Debian-compatible
#   - Run as root (sudo su -) from inside a clone of this repo
#   - Outbound HTTPS so NodeSource + GitHub are reachable
#
# What it does:
#   1. Installs Node.js 22 (NodeSource) if `node` is missing/too old
#   2. Creates a dedicated system user + a data directory outside the repo
#   3. Installs a systemd unit so the store starts on boot and auto-restarts
#   4. Prints how to open the firewall + reach the site
#
# Usage:
#   git clone https://github.com/steamytooolz-commits/general-store.git /opt/general-store
#   cd /opt/general-store
#   sudo ./deploy/oracle/setup-oracle.sh

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DATA_DIR="/var/lib/general-store"
APP_USER="store"
SERVICE="general-store.service"

if [ "$(id -u)" -ne 0 ]; then
  echo "error: run as root, e.g.  sudo $0" >&2
  exit 1
fi

if [ ! -f "$APP_DIR/package.json" ] || [ ! -d "$APP_DIR/src" ]; then
  echo "error: no General Store checkout found at $APP_DIR" >&2
  echo "hint:  git clone https://github.com/steamytooolz-commits/general-store.git $APP_DIR" >&2
  exit 1
fi

if [[ "$APP_DIR" == /root/* ]] || [[ "$APP_DIR" == /home/* ]]; then
  echo "warning: $APP_DIR is under a user home directory; root-owned services can struggle" \
       "to read it. Consider /opt/general-store instead."
fi

# ---- 1. Node.js -----------------------------------------------------------
if ! command -v node >/dev/null 2>&1 || [ "$(node -e 'console.log(process.versions.node.split(".")[0])')" -lt 22 ]; then
  echo "==> Installing Node.js 22 from NodeSource…"
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg git
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi
echo "==> Node $(node --version) — SQLite module: $(node -e 'console.log(!!require("node:sqlite"))' 2>/dev/null || echo 'needs flag')"

# ---- 2. App user + data dir ------------------------------------------------
if ! id "$APP_USER" >/dev/null 2>&1; then
  echo "==> Creating system user '$APP_USER'…"
  useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
fi
mkdir -p "$DATA_DIR"
chown -R "$APP_USER":"$APP_USER" "$DATA_DIR" "$APP_DIR"

# ---- 3. systemd service -----------------------------------------------------
echo "==> Installing /etc/systemd/system/$SERVICE…"
cat > "/etc/systemd/system/$SERVICE" <<EOF
[Unit]
Description=General Store — online store
Documentation=https://github.com/steamytooolz-commits/general-store
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=DB_PATH=$DATA_DIR/store.db
ExecStart=/usr/bin/node --experimental-sqlite src/server.js
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now "$SERVICE"
sleep 1
if systemctl is-active --quiet "$SERVICE"; then
  echo "==> Service is running ✓"
else
  echo "==> Service failed to start — recent logs:"
  journalctl -u "$SERVICE" -n 30 --no-pager || true
fi

# ---- 4. Firewall + reachability ---------------------------------------------
if command -v ufw >/dev/null 2>&1; then
  ufw allow 3000/tcp >/dev/null 2>&1 || true
fi
PUBLIC_IP="$(curl -fsSL --max-time 5 ifconfig.me 2>/dev/null || echo '<public-ip>')"
cat <<'EOF'

─── Next steps ─────────────────────────────────────────────────────────────
  • Oracle Cloud console → Networking → Virtual Cloud Networks → your VCN →
    Security List → Add ingress rule: TCP 3000 from 0.0.0.0/0 (or your IP).
  • Then open:  http://<public-ip>:3000
  • Useful commands:
      sudo systemctl status general-store      # health
      sudo journalctl -u general-store -f      # logs
      curl http://127.0.0.1:3000/api/products  # local check
  • Update the app later:
      cd /opt/general-store && sudo git pull && sudo chown -R store:store /opt/general-store
  • For HTTPS on a domain name, install Caddy (auto-TLS) and proxy to :3000 —
    see the README "Deploy" section.
─────────────────────────────────────────────────────────────────────────────
EOF
echo "Reachable at: http://$PUBLIC_IP:3000"