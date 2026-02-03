#!/bin/bash

# AgentBackend Remote Backend Entrypoint
# Starts agentbe-daemon with integrated MCP + SSH management

set -e

echo "🌟 Starting AgentBackend Remote Backend..."

# Read environment variables with defaults
WORKSPACE_ROOT="${WORKSPACE_ROOT:-/workspace}"
MCP_PORT="${MCP_PORT:-3001}"
MCP_AUTH_TOKEN="${MCP_AUTH_TOKEN:-}"
SSH_USERS="${SSH_USERS:-root:agents}"

# Create workspace directory
mkdir -p "$WORKSPACE_ROOT"
chmod 755 "$WORKSPACE_ROOT"

echo "🚀 Starting agentbe-daemon (MCP + SSH)..."
echo "   Workspace: $WORKSPACE_ROOT"
echo "   MCP Port: $MCP_PORT"
echo "   SSH Users: $SSH_USERS"
echo ""

# Build command arguments
DAEMON_ARGS=(
  --rootDir "$WORKSPACE_ROOT"
  --mcp-port "$MCP_PORT"
  --ssh-users "$SSH_USERS"
)

# Add auth token if provided
if [ -n "$MCP_AUTH_TOKEN" ]; then
  DAEMON_ARGS+=(--mcp-auth-token "$MCP_AUTH_TOKEN")
fi

# Add SSH public key if provided
if [ -n "$SSH_PUBLIC_KEY" ]; then
  DAEMON_ARGS+=(--ssh-public-key "$SSH_PUBLIC_KEY")
fi

# Add SSH authorized_keys file if mounted
if [ -f /keys/authorized_keys ]; then
  DAEMON_ARGS+=(--ssh-authorized-keys /keys/authorized_keys)
fi

# Run unified daemon (handles all user setup + starts both services)
exec agent-backend daemon "${DAEMON_ARGS[@]}"
