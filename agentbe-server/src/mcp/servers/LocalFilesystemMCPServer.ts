import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { LocalFilesystemBackend } from 'constellationfs';
import { registerExecTool, registerFilesystemTools } from '../base/tools.js';

/**
 * MCP Server for LocalFilesystemBackend.
 * Provides all filesystem tools plus exec tool for local command execution.
 */
export class LocalFilesystemMCPServer {
  public server: McpServer & { name: string; version: string; getTools(): Record<string, any> }
  private backend: LocalFilesystemBackend
  private tools: Map<string, any> = new Map()

  constructor(backend: LocalFilesystemBackend) {
    this.backend = backend

    const baseServer = new McpServer({
      name: 'local-filesystem',
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
      name: 'local-filesystem',
      version: '1.0.0',
      getTools: () => Object.fromEntries(this.tools)
    }) as any

    // Register all filesystem tools (read, write, directory operations, etc.)
    registerFilesystemTools(this.server, async () => this.backend)

    // Register exec tool (supported for filesystem backends)
    registerExecTool(this.server, async () => this.backend)
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
  getBackend(): LocalFilesystemBackend {
    return this.backend
  }
}
