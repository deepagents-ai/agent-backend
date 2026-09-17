#!/usr/bin/env bash
# Runs tls-proxy.test.ts against a host daemon behind a Caddy TLS proxy (Docker).
# Caddy's local CA is trusted through NODE_EXTRA_CA_CERTS, which Node only reads at
# startup, so the proxy has to be up before vitest launches.
set -euo pipefail

cd "$(dirname "$0")/../../.."
PKG_DIR=$(pwd)
DAEMON_PORT=${DAEMON_PORT:-3931}
PROXY_PORT=${PROXY_PORT:-8443}
TOKEN="tls-proxy-$(openssl rand -hex 16)"
WORK=$(mktemp -d)
ROOT_DIR="$WORK/workspace"
CONTAINER="agentbe-tls-proxy-test"
mkdir -p "$ROOT_DIR"

cleanup() {
  [[ -n "${DAEMON_PID:-}" ]] && kill "$DAEMON_PID" 2>/dev/null || true
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

# AUTH_TOKEN/MCP_AUTH_TOKEN in the environment, as the Docker entrypoint provides it,
# so the suite can check commands never see it
AUTH_TOKEN="$TOKEN" MCP_AUTH_TOKEN="$TOKEN" npx tsx src/cli.ts daemon --rootDir "$ROOT_DIR" --port "$DAEMON_PORT" \
  --auth-token "$TOKEN" --isolation software >"$WORK/daemon.log" 2>&1 &
DAEMON_PID=$!

docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$CONTAINER" \
  --add-host host.docker.internal:host-gateway \
  -e PROXY_PORT="$PROXY_PORT" -e DAEMON_PORT="$DAEMON_PORT" \
  -p "127.0.0.1:$PROXY_PORT:$PROXY_PORT" \
  -v "$PKG_DIR/tests/integration/tls-proxy/Caddyfile:/etc/caddy/Caddyfile:ro" \
  caddy:2-alpine >/dev/null

CA="$WORK/caddy-root.crt"
for _ in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:$DAEMON_PORT/health" >/dev/null \
    && docker cp "$CONTAINER:/data/caddy/pki/authorities/local/root.crt" "$CA" 2>/dev/null \
    && curl -sf --cacert "$CA" -H 'x-route: a' "https://localhost:$PROXY_PORT/health" >/dev/null; then
    break
  fi
  sleep 1
done
if ! curl -sf --cacert "$CA" -H 'x-route: a' "https://localhost:$PROXY_PORT/health" >/dev/null; then
  echo "Proxy did not come up" >&2
  cat "$WORK/daemon.log" >&2
  docker logs "$CONTAINER" >&2
  exit 1
fi

NODE_EXTRA_CA_CERTS="$CA" \
AGENTBE_TLS_PROXY_PORT="$PROXY_PORT" \
AGENTBE_TLS_PROXY_TOKEN="$TOKEN" \
AGENTBE_TLS_PROXY_ROOT="$ROOT_DIR" \
  npx vitest run --config vitest.integration.config.ts tests/integration/tls-proxy.test.ts
