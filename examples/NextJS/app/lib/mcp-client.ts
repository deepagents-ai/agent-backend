import { backendManager } from './backend'

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
 * - Requires mcpServerUrl to be configured
 * - MCP server must be started on remote: agent-backend --http-port 3001
 */
export async function createMCPClient() {
  // Get the backend (Local or Remote based on env)
  const backend = await backendManager.getBackend()

  // Let backend handle MCP client creation
  // - Local: spawns CLI via stdio
  // - Remote: connects to HTTP server at config.mcpServerUrl
  const client = await backend.getMCPClient()

  return client
}
