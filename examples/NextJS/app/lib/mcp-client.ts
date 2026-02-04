import { backendManager } from './backend'

// MCP client cache - exported so it can be cleared on config change
const mcpClientCache = new Map<string, any>()

/**
 * Clear all cached MCP clients (call when backend config changes)
 */
export function clearMCPClients() {
  console.log('[mcp-client] Clearing', mcpClientCache.size, 'cached clients')
  // Close all clients before clearing
  for (const [sessionId, client] of mcpClientCache) {
    try {
      client.close?.()
    } catch (e) {
      console.warn('[mcp-client] Error closing client:', e)
    }
  }
  mcpClientCache.clear()
}

/**
 * Get or create an MCP client for a session
 */
export async function getMCPClientForSession(sessionId: string) {
  if (mcpClientCache.has(sessionId)) {
    return mcpClientCache.get(sessionId)
  }

  const client = await createMCPClient()
  mcpClientCache.set(sessionId, client)
  return client
}

/**
 * Create an MCP client using the configured backend.
 *
 * For local backends:
 * - Automatically spawns agent-backend CLI via stdio
 * - No separate process management needed
 * - MCP server runs in same system as files
 *
 * For remote backends:
 * - Connects to HTTP MCP server on remote host
 * - Uses host and mcpPort from config (mcpServerHostOverride if specified)
 * - MCP server must be started on remote: agent-backend daemon --rootDir /agentbe
 */
export async function createMCPClient() {
  // Get the backend (Local or Remote based on env)
  const backend = await backendManager.getBackend()
  console.log('[mcp-client] Creating MCP client for backend type:', backend.type)

  // Let backend handle MCP client creation
  // - Local: spawns CLI via stdio
  // - Remote: connects to HTTP server at http://{host}:{mcpPort}
  const client = await backend.getMCPClient()

  return client
}
