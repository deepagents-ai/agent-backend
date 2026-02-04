/**
 * Vercel AI SDK Adapter
 *
 * Provides MCP transports for use with Vercel AI SDK's createMCPClient
 * or any other MCP-compatible client.
 *
 * Transport type depends on backend:
 * - LocalFilesystemBackend → StdioClientTransport (spawns subprocess)
 * - RemoteFilesystemBackend → StreamableHTTPClientTransport (HTTP)
 * - MemoryBackend → StdioClientTransport (spawns subprocess)
 */

import type { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Backend, FileBasedBackend, ScopedBackend } from '../backends/types.js'
import { BackendType } from '../backends/types.js'
import { BackendError } from '../types.js'
import { ERROR_CODES } from '../constants.js'

/**
 * Union type for MCP transports
 */
export type MCPTransport = StdioClientTransport | StreamableHTTPClientTransport

/**
 * Backend with optional config property (for RemoteFilesystemBackend)
 */
interface BackendWithConfig extends Backend {
  config?: {
    host?: string
    mcpPort?: number
    mcpServerHostOverride?: string
    mcpAuth?: {
      token: string
    }
  }
}

/**
 * Backend with optional isolation and shell properties (for LocalFilesystemBackend)
 */
interface LocalBackendLike extends FileBasedBackend {
  isolation?: 'auto' | 'bwrap' | 'software' | 'none'
  shell?: string
}

/**
 * Check if a backend is a scoped backend
 */
function isScopedBackend<T extends FileBasedBackend>(
  backend: Backend | FileBasedBackend | ScopedBackend<T>
): backend is ScopedBackend<T> {
  return 'parent' in backend && 'scopePath' in backend
}

/**
 * Get the root backend from a potentially scoped backend
 */
function getRootBackend<T extends FileBasedBackend>(
  backend: Backend | FileBasedBackend | ScopedBackend<T>
): Backend | FileBasedBackend {
  if (isScopedBackend(backend)) {
    // Traverse up to find the root backend
    let current: FileBasedBackend | ScopedBackend<FileBasedBackend> = backend.parent
    while (isScopedBackend(current)) {
      current = current.parent
    }
    return current
  }
  return backend
}

/**
 * Adapter for creating MCP transports compatible with Vercel AI SDK
 *
 * @example
 * ```typescript
 * import { experimental_createMCPClient as createMCPClient } from '@ai-sdk/mcp'
 * import { LocalFilesystemBackend, VercelAIAdapter } from 'agent-backend'
 *
 * const backend = new LocalFilesystemBackend({ rootDir: '/tmp/workspace' })
 * const adapter = new VercelAIAdapter(backend)
 *
 * const transport = await adapter.getTransport()
 * const mcpClient = await createMCPClient({ transport })
 * const tools = await mcpClient.tools()
 * ```
 */
export class VercelAIAdapter<T extends Backend | FileBasedBackend | ScopedBackend<FileBasedBackend>> {
  private readonly backend: T

  constructor(backend: T) {
    this.backend = backend
  }

  /**
   * Get MCP transport for use with any MCP-compatible client.
   * Works with Vercel AI SDK's createMCPClient or raw MCP SDK.
   *
   * Transport type depends on backend:
   * - LocalFilesystemBackend → StdioClientTransport (spawns subprocess)
   * - RemoteFilesystemBackend → StreamableHTTPClientTransport (HTTP)
   * - MemoryBackend → StdioClientTransport (spawns subprocess)
   *
   * @returns MCP transport configured for the backend type
   */
  async getTransport(): Promise<MCPTransport> {
    // Get root backend for type detection and config access
    const rootBackend = getRootBackend(this.backend)
    const backendType = rootBackend.type

    // Get the effective rootDir (scoped if applicable)
    const effectiveRootDir = this.getEffectiveRootDir()

    switch (backendType) {
      case BackendType.LOCAL_FILESYSTEM:
        return this.createStdioTransport(rootBackend as LocalBackendLike, effectiveRootDir)

      case BackendType.REMOTE_FILESYSTEM:
        return this.createHttpTransport(rootBackend as BackendWithConfig)

      case BackendType.MEMORY:
        return this.createMemoryTransport(effectiveRootDir)

      default:
        throw new BackendError(
          `Unsupported backend type: ${backendType}. VercelAIAdapter supports LOCAL_FILESYSTEM, REMOTE_FILESYSTEM, and MEMORY backends.`,
          ERROR_CODES.INVALID_CONFIGURATION,
          'unsupported-backend-type'
        )
    }
  }

  /**
   * Get the effective rootDir, considering scoped backends
   */
  private getEffectiveRootDir(): string {
    if ('rootDir' in this.backend) {
      return (this.backend as FileBasedBackend).rootDir
    }
    // Fallback for non-file-based backends
    return '/'
  }

  /**
   * Create Stdio transport for local filesystem backend
   */
  private async createStdioTransport(
    backend: LocalBackendLike,
    rootDir: string
  ): Promise<StdioClientTransport> {
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js')

    const args = [
      'daemon',
      '--rootDir', rootDir,
      '--local-only',
    ]

    // Access isolation through duck typing (may be private)
    const isolation = this.getBackendProperty<string>(backend, 'isolation') ||
                      this.getBackendProperty<string>(backend, 'actualIsolation')
    if (isolation && isolation !== 'auto') {
      args.push('--isolation', isolation)
    }

    // Access shell through duck typing
    const shell = this.getBackendProperty<string>(backend, 'shell')
    if (shell && shell !== 'auto') {
      args.push('--shell', shell)
    }

    return new StdioClientTransport({
      command: 'agent-backend',
      args,
    })
  }

  /**
   * Create HTTP transport for remote filesystem backend
   */
  private async createHttpTransport(
    backend: BackendWithConfig
  ): Promise<StreamableHTTPClientTransport> {
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js')

    const config = backend.config
    if (!config?.host) {
      throw new BackendError(
        'RemoteFilesystemBackend requires host to be configured. ' +
        'The MCP server must run on the remote host and be accessible via HTTP.',
        ERROR_CODES.INVALID_CONFIGURATION,
        'host'
      )
    }

    const mcpHost = config.mcpServerHostOverride || config.host
    const mcpPort = config.mcpPort || 3001
    const mcpServerUrl = `http://${mcpHost}:${mcpPort}`

    return new StreamableHTTPClientTransport(
      new URL('/mcp', mcpServerUrl),
      {
        requestInit: {
          headers: {
            ...(config.mcpAuth?.token && {
              'Authorization': `Bearer ${config.mcpAuth.token}`,
            }),
          },
        },
      }
    )
  }

  /**
   * Create Stdio transport for memory backend
   */
  private async createMemoryTransport(rootDir: string): Promise<StdioClientTransport> {
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js')

    const args = [
      '--backend', 'memory',
      '--rootDir', rootDir,
    ]

    return new StdioClientTransport({
      command: 'agent-backend',
      args,
    })
  }

  /**
   * Safely access a property on a backend (handles private properties)
   */
  private getBackendProperty<V>(backend: object, key: string): V | undefined {
    // Try direct access first (for public/protected properties)
    if (key in backend) {
      return (backend as Record<string, V>)[key]
    }
    return undefined
  }
}
