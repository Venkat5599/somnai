#!/usr/bin/env bash
#
# Stand up the PRISM MCP server on a fresh Linux box.
#
#   curl -fsSL https://raw.githubusercontent.com/Venkat5599/somnai/main/scripts/deploy-mcp.sh | bash
#
# or, from a checkout:
#
#   MCP_HTTP_TOKEN=<64 hex> bash scripts/deploy-mcp.sh
#
# Idempotent: safe to run again after a git pull. Installs bun if missing,
# fetches the repo, writes a systemd unit, and starts the service.
#
# WHAT IT DELIBERATELY DOES NOT DO:
#
#   - it does not invent a token. MCP_HTTP_TOKEN must be supplied, because a
#     script that generates a default is a script whose default ends up in
#     production.
#   - it does not open the port to the world. The service binds 127.0.0.1 and
#     the notes at the end explain putting a TLS proxy in front. A trading
#     endpoint on plain HTTP across the internet is not a deployment, it is an
#     incident waiting for a scanner.
#   - it does not arm trading. AGENT_DRY_RUN stays true until you change it.

set -euo pipefail

REPO="${PRISM_REPO:-https://github.com/Venkat5599/somnai.git}"
DIR="${PRISM_DIR:-/opt/prism}"
PORT="${MCP_HTTP_PORT:-8787}"
SERVICE="prism-mcp"

if [ -z "${MCP_HTTP_TOKEN:-}" ]; then
  echo "FATAL: MCP_HTTP_TOKEN is required (32+ characters)." >&2
  echo "Generate one:  openssl rand -hex 32" >&2
  exit 1
fi
if [ "${#MCP_HTTP_TOKEN}" -lt 24 ]; then
  echo "FATAL: MCP_HTTP_TOKEN must be at least 24 characters." >&2
  exit 1
fi

echo "==> bun"
if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
fi
BUN="$(command -v bun)"
echo "    $BUN"

echo "==> source at $DIR"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch --quiet origin main
  git -C "$DIR" reset --hard --quiet origin/main
else
  mkdir -p "$(dirname "$DIR")"
  git clone --quiet --depth 1 "$REPO" "$DIR"
fi

echo "==> dependencies"
(cd "$DIR" && "$BUN" install --frozen-lockfile >/dev/null 2>&1 || "$BUN" install >/dev/null)

echo "==> service"
if command -v systemctl >/dev/null 2>&1; then
  cat >"/etc/systemd/system/${SERVICE}.service" <<UNIT
[Unit]
Description=PRISM MCP server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${DIR}
ExecStart=${BUN} --conditions react-server backend/mcp/http.ts
Restart=always
RestartSec=3

Environment=MCP_HTTP_TOKEN=${MCP_HTTP_TOKEN}
Environment=MCP_HTTP_PORT=${PORT}
Environment=MCP_HTTP_HOST=127.0.0.1
Environment=PRISM_NETWORK=testnet
# Reading the venue needs no key. Trading stays off until you say otherwise.
Environment=PRISM_DRY_RUN=true
Environment=AGENT_DRY_RUN=true
Environment=AGENT_BUDGET=5
Environment=AGENT_MAX_ORDER=1
Environment=AGENT_MAX_TRADES=10

# The service reads the venue and, when armed, signs. It needs no privileges
# beyond its own directory.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${DIR}

[Install]
WantedBy=multi-user.target
UNIT

  systemctl daemon-reload
  systemctl enable --now "${SERVICE}"
  sleep 2
  systemctl --no-pager --lines=5 status "${SERVICE}" || true
else
  echo "    no systemd; starting in the background instead"
  (cd "$DIR" && MCP_HTTP_TOKEN="$MCP_HTTP_TOKEN" MCP_HTTP_PORT="$PORT" \
    nohup "$BUN" --conditions react-server backend/mcp/http.ts >/var/log/prism-mcp.log 2>&1 &)
  sleep 2
fi

echo "==> health"
curl -fsS "http://127.0.0.1:${PORT}/health" && echo

cat <<NOTES

Running on 127.0.0.1:${PORT}. It is NOT reachable from outside yet, which is
deliberate — finish these two steps before pointing anything at it:

  1. TLS + a public name. Plain HTTP would put a bearer token that authorises
     trades on the wire in clear text. Caddy is one line:

       yourdomain.com {
         reverse_proxy 127.0.0.1:${PORT}
       }

  2. Arm it only when you mean to. It reads the venue and refuses every order
     until you set AGENT_DRY_RUN=false, and it needs PRIVATE_KEY in the unit to
     sign at all. Both are deliberate omissions, not oversights.

Point a client at:  https://yourdomain.com/mcp
                    Authorization: Bearer <your token>
Health, unauthenticated:  https://yourdomain.com/health

NOTES
