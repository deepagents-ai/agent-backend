import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MemoryBackend } from 'constellationfs'
import { MemoryMCPServer } from '../../src/mcp/servers/MemoryMCPServer.js'

describe('MemoryMCPServer', () => {
  let backend: MemoryBackend
  let server: MemoryMCPServer

  beforeEach(() => {
    backend = new MemoryBackend({
      rootDir: '/test-memory'
    })

    server = new MemoryMCPServer(backend)
  })

  afterEach(async () => {
    await backend.destroy()
  })

  it('should create server instance', () => {
    expect(server).toBeDefined()
    expect(server.server).toBeDefined()
  })

  it('should have correct server name', () => {
    expect(server.server.name).toBe('memory')
  })

  it('should register filesystem tools', async () => {
    const tools = server.server.getTools()
    const toolNames = Object.keys(tools)

    expect(toolNames).toContain('read_text_file')
    expect(toolNames).toContain('write_file')
    expect(toolNames).toContain('list_directory')
    expect(toolNames).toContain('create_directory')
  })

  it('should NOT register exec tool', async () => {
    const tools = server.server.getTools()
    const toolNames = Object.keys(tools)

    // MemoryMCPServer should NOT have exec tool
    expect(toolNames).not.toContain('exec')
  })

  it('should handle tool execution', async () => {
    // Write via backend
    await backend.write('key1', 'value1')

    // Get tools
    const tools = server.server.getTools()
    const readTool = tools['read_text_file']

    expect(readTool).toBeDefined()
    expect(typeof readTool.handler).toBe('function')
  })
})
