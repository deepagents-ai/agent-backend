#!/bin/bash

# agentbe-daemon Docker Entrypoint
# Translates environment variables to CLI arguments
#
# Environment variables (all optional, CLI has defaults):
#   WORKSPACE_ROOT    - Root directory to serve (default: /var/workspace)
#   MCP_PORT          - MCP server port (default: 3001)
#   MCP_AUTH_TOKEN    - Bearer token for MCP authentication
#   SSH_PORT          - SSH daemon port (default: 22)
#   SSH_USERS         - Comma-separated user:pass pairs
#   SSH_PUBLIC_KEY    - SSH public key to add to authorized_keys
#
# Can also mount /keys/authorized_keys for SSH key auth

set -e

# Only WORKSPACE_ROOT needs a default since rootDir is required by CLI
WORKSPACE_ROOT="${WORKSPACE_ROOT:-/var/workspace}"

# Create workspace directory
mkdir -p "$WORKSPACE_ROOT"
chmod 755 "$WORKSPACE_ROOT"

echo "Starting agentbe-daemon..."
echo "  Workspace: $WORKSPACE_ROOT"

# Build command arguments - only add flags if env vars are set
DAEMON_ARGS=(--rootDir "$WORKSPACE_ROOT")

if [ -n "$MCP_PORT" ]; then
  DAEMON_ARGS+=(--mcp-port "$MCP_PORT")
  echo "  MCP Port: $MCP_PORT"
fi

if [ -n "$MCP_AUTH_TOKEN" ]; then
  DAEMON_ARGS+=(--mcp-auth-token "$MCP_AUTH_TOKEN")
  echo "  MCP Auth: enabled"
fi

if [ -n "$SSH_PORT" ]; then
  DAEMON_ARGS+=(--ssh-port "$SSH_PORT")
  echo "  SSH Port: $SSH_PORT"
fi

if [ -n "$SSH_USERS" ]; then
  DAEMON_ARGS+=(--ssh-users "$SSH_USERS")
  echo "  SSH Users: $SSH_USERS"
fi

if [ -n "$SSH_PUBLIC_KEY" ]; then
  DAEMON_ARGS+=(--ssh-public-key "$SSH_PUBLIC_KEY")
  echo "  SSH Key: provided via env"
fi

if [ -f /keys/authorized_keys ]; then
  DAEMON_ARGS+=(--ssh-authorized-keys /keys/authorized_keys)
  echo "  SSH Keys: /keys/authorized_keys"
fi

echo ""

# Ensure we're in a valid directory
cd "$WORKSPACE_ROOT"

# Use local mounted build with nodemon for hot-reload in dev mode
if [ "$USE_LOCAL_BUILD" = "1" ] && [ -d /app/agent-backend ]; then
  echo "🔥 Hot-reload enabled (watching /app/agent-backend)"
  exec npx nodemon \
    --watch /app/agent-backend \
    --ext js \
    --exec "cd $WORKSPACE_ROOT && node /app/agent-backend/bin/agent-backend.js daemon ${DAEMON_ARGS[*]}"
else
  exec agent-backend daemon "${DAEMON_ARGS[@]}"
fi
