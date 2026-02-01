import { LocalFilesystemBackend } from 'agent-backend'
import { randomBytes } from 'crypto'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LocalFilesystemMCPServer } from '../../src/mcp/servers/LocalFilesystemMCPServer.js'

function getTempDir(): string {
  const randomId = randomBytes(8).toString('hex')
  return join(tmpdir(), `agentbe-test-${randomId}`)
}

describe('LocalFilesystemMCPServer', () => {
  let backend: LocalFilesystemBackend
  let server: LocalFilesystemMCPServer

  beforeEach(() => {
    backend = new LocalFilesystemBackend({
      rootDir: getTempDir(),
      isolation: 'software',
      preventDangerous: true
    })

    server = new LocalFilesystemMCPServer(backend)
  })

  afterEach(async () => {
    await backend.destroy()
  })

  it('should create server instance', () => {
    expect(server).toBeDefined()
    expect(server.server).toBeDefined()
  })

  it('should have correct server name', () => {
    expect(server.server.name).toBe('local-filesystem')
  })

  it('should register filesystem tools', async () => {
    const tools = server.server.getTools()
    const toolNames = Object.keys(tools)

    expect(toolNames).toContain('read_text_file')
    expect(toolNames).toContain('write_file')
    expect(toolNames).toContain('list_directory')
    expect(toolNames).toContain('create_directory')
    expect(toolNames).toContain('move_file')
    expect(toolNames).toContain('search_files')
  })

  it('should register exec tool', async () => {
    const tools = server.server.getTools()
    const toolNames = Object.keys(tools)

    // LocalFilesystemMCPServer SHOULD have exec tool
    expect(toolNames).toContain('exec')
  })

  it('should handle tool execution', async () => {
    // Write a file via backend
    await backend.write('test.txt', 'Hello, MCP!')

    // Get the read_text_file tool handler
    const tools = server.server.getTools()
    const readTool = tools['read_text_file']

    expect(readTool).toBeDefined()

    // Tool handlers will be called by MCP SDK, we're just testing they exist
    expect(typeof readTool.handler).toBe('function')
  })
})
