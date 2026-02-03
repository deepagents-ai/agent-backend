import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { spawn } from 'child_process'
import { mkdir as fsMkdir, readdir, readFile, rename as fsRename, writeFile } from 'fs/promises'
import * as path from 'path'
import { z } from 'zod'
import { isCommandSafe } from '../safety.js'
import { BackendError, DangerousOperationError } from '../types.js'

/**
 * Configuration for AgentBackendMCPServer
 */
export interface AgentBackendMCPServerConfig {
  /** Root directory to serve */
  rootDir: string

  /** Isolation mode for command execution */
  isolation?: 'auto' | 'bwrap' | 'software' | 'none'

  /** Shell to use for command execution */
  shell?: 'bash' | 'sh' | 'auto'

  /** Prevent dangerous operations */
  preventDangerous?: boolean
}

/**
 * AgentBackend MCP Server
 *
 * A simple MCP server that serves filesystem tools directly.
 * NO Backend abstraction - just implements the tools using Node.js fs APIs.
 *
 * This is what runs in the daemon (agentbed).
 */
export class AgentBackendMCPServer {
  public server: McpServer & { name: string; version: string; getTools(): Record<string, any> }
  private tools: Map<string, any> = new Map()
  private rootDir: string
  private shell: string
  private preventDangerous: boolean

  constructor(config: AgentBackendMCPServerConfig) {
    this.rootDir = path.resolve(config.rootDir)
    this.shell = config.shell ?? 'auto'
    this.preventDangerous = config.preventDangerous ?? true

    const baseServer = new McpServer({
      name: 'agentbed',
      version: '1.0.0'
    })

    // Wrap the server to track tool registrations
    const originalRegisterTool = baseServer.registerTool.bind(baseServer)
    baseServer.registerTool = ((name: string, config: any, handler: any) => {
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

    this.server = Object.assign(baseServer, {
      name: 'agentbed',
      version: '1.0.0',
      getTools: () => Object.fromEntries(this.tools)
    }) as any

    // Register all filesystem tools
    this.registerTools()
  }

  private resolvePath(filePath: string): string {
    // Make path absolute relative to rootDir
    const resolved = path.isAbsolute(filePath)
      ? path.resolve(this.rootDir, filePath.slice(1))
      : path.resolve(this.rootDir, filePath)

    // Ensure path doesn't escape rootDir
    if (!resolved.startsWith(this.rootDir)) {
      throw new BackendError(
        `Path escapes root directory: ${filePath}`,
        'PATH_ESCAPE'
      )
    }

    return resolved
  }

  private registerTools() {
    // read_file tool
    this.server.registerTool('read_file', {
      description: 'Read complete contents of a file from the filesystem',
      inputSchema: {
        path: z.string().describe('Path to file to read')
      }
    }, async ({ path: filePath }: any) => {
      const resolved = this.resolvePath(filePath)
      const content = await readFile(resolved, 'utf-8')
      return {
        content: [{
          type: 'text',
          text: content
        }]
      }
    })

    // write_file tool
    this.server.registerTool('write_file', {
      description: 'Write content to a file',
      inputSchema: {
        path: z.string().describe('Path to file to write'),
        content: z.string().describe('Content to write')
      }
    }, async ({ path: filePath, content }: any) => {
      const resolved = this.resolvePath(filePath)

      // Ensure parent directory exists
      const dir = path.dirname(resolved)
      await fsMkdir(dir, { recursive: true })

      await writeFile(resolved, content, 'utf-8')
      return {
        content: [{
          type: 'text',
          text: `Successfully wrote to ${filePath}`
        }]
      }
    })

    // list_directory tool
    this.server.registerTool('list_directory', {
      description: 'List contents of a directory',
      inputSchema: {
        path: z.string().describe('Path to directory')
      }
    }, async ({ path: dirPath }: any) => {
      const resolved = this.resolvePath(dirPath)
      const entries = await readdir(resolved, { withFileTypes: true })

      const listing = entries.map(entry => ({
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file'
      }))

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(listing, null, 2)
        }]
      }
    })

    // create_directory tool
    this.server.registerTool('create_directory', {
      description: 'Create a new directory',
      inputSchema: {
        path: z.string().describe('Path to directory to create')
      }
    }, async ({ path: dirPath }: any) => {
      const resolved = this.resolvePath(dirPath)
      await fsMkdir(resolved, { recursive: true })
      return {
        content: [{
          type: 'text',
          text: `Successfully created directory ${dirPath}`
        }]
      }
    })

    // move_file tool
    this.server.registerTool('move_file', {
      description: 'Move or rename a file',
      inputSchema: {
        source: z.string().describe('Source path'),
        destination: z.string().describe('Destination path')
      }
    }, async ({ source, destination }: any) => {
      const resolvedSrc = this.resolvePath(source)
      const resolvedDest = this.resolvePath(destination)

      // Ensure destination directory exists
      const destDir = path.dirname(resolvedDest)
      await fsMkdir(destDir, { recursive: true })

      await fsRename(resolvedSrc, resolvedDest)
      return {
        content: [{
          type: 'text',
          text: `Successfully moved ${source} to ${destination}`
        }]
      }
    })

    // exec tool
    this.server.registerTool('exec', {
      description: 'Execute a shell command',
      inputSchema: {
        command: z.string().describe('Command to execute'),
        timeout: z.number().optional().describe('Timeout in milliseconds (default: 120000)')
      }
    }, async ({ command, timeout = 120000 }: any) => {
      // Safety check
      if (this.preventDangerous) {
        const safetyResult = isCommandSafe(command)
        if (!safetyResult.safe) {
          throw new DangerousOperationError(
            `Dangerous command blocked: ${safetyResult.reason}`
          )
        }
      }

      return new Promise((resolve, reject) => {
        const proc = spawn(command, {
          cwd: this.rootDir,
          shell: this.shell === 'auto' ? true : this.shell,
          timeout
        })

        let stdout = ''
        let stderr = ''

        proc.stdout?.on('data', (data) => {
          stdout += data.toString()
        })

        proc.stderr?.on('data', (data) => {
          stderr += data.toString()
        })

        proc.on('close', (code) => {
          resolve({
            content: [{
              type: 'text',
              text: JSON.stringify({
                exitCode: code ?? 0,
                stdout,
                stderr
              }, null, 2)
            }]
          })
        })

        proc.on('error', (error) => {
          reject(new BackendError(
            `Command execution failed: ${error.message}`,
            'COMMAND_FAILED'
          ))
        })

        // Handle timeout
        const timeoutId = setTimeout(() => {
          proc.kill()
          reject(new BackendError(
            `Command timed out after ${timeout}ms`,
            'TIMEOUT'
          ))
        }, timeout)

        proc.on('close', () => clearTimeout(timeoutId))
      })
    })
  }

  getServer(): McpServer {
    return this.server
  }
}
