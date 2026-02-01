import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MemoryBackend } from 'agent-backend';
import { registerFilesystemTools } from '../base/tools.js';
// Note: Do NOT import registerExecTool - MemoryBackend does not support exec

/**
 * MCP Server for MemoryBackend.
 * Provides filesystem tools only - NO exec tool.
 * MemoryBackend is a key/value store and does not support command execution.
 */
export class MemoryMCPServer {
  public server: McpServer & { name: string; version: string; getTools(): Record<string, any> }
  private backend: MemoryBackend
  private tools: Map<string, any> = new Map()

  constructor(backend: MemoryBackend) {
    this.backend = backend

    const baseServer = new McpServer({
      name: 'memory',
      version: '1.0.0'
    })

    // Wrap the server to track tool registrations
    const originalRegisterTool = baseServer.registerTool.bind(baseServer)
    baseServer.registerTool = ((name: string, config: any, handler: any) => {
      // Ensure inputSchema has type field for JSON Schema compatibility
      const inputSchema = config.inputSchema
        ? { type: 'object', ...config.inputSchema }
        : undefined

      this.tools.set(name, {
        name,
        description: config.description,
        inputSchema,
        handler
      })
      return originalRegisterTool(name, config, handler)
    }) as any

    // Add getTools method and preserve name/version
    this.server = Object.assign(baseServer, {
      name: 'memory',
      version: '1.0.0',
      getTools: () => Object.fromEntries(this.tools)
    }) as any

    // Register filesystem tools only (read, write, directory operations)
    registerFilesystemTools(this.server as any, async () => this.backend)

    // DO NOT register exec tool - MemoryBackend.exec() throws NotImplementedError
  }

  /**
   * Get the underlying MCP server instance.
   * Use this to connect transports or access server methods.
   */
  getServer(): McpServer {
    return this.server
  }

  /**
   * Get the backend instance this server is wrapping.
   */
  getBackend(): MemoryBackend {
    return this.backend
  }
}
