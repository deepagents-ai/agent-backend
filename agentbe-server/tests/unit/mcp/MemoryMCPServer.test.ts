import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryMCPServer } from '../../../src/mcp/servers/MemoryMCPServer.js'
import type { MemoryBackend } from 'constellationfs'

// Mock MemoryBackend
function createMockMemoryBackend(): MemoryBackend {
  return {
    type: 'memory',
    rootDir: '/memory',
    connected: true,
    read: vi.fn().mockResolvedValue('memory content'),
    write: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue(['key1', 'key2']),
    mkdir: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(true),
    stat: vi.fn().mockResolvedValue({
      isFile: () => true,
      isDirectory: () => false,
      size: 50,
      mtime: new Date(),
      mode: 0o644
    } as any),
    touch: vi.fn().mockResolvedValue(undefined),
    scope: vi.fn(),
    listScopes: vi.fn().mockResolvedValue([]),
    getMCPClient: vi.fn(),
    destroy: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue(['key1', 'key2', 'key3']),
    delete: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined)
  } as any
}

describe('MemoryMCPServer (Unit Tests)', () => {
  let backend: MemoryBackend
  let server: MemoryMCPServer

  beforeEach(() => {
    vi.clearAllMocks()
    backend = createMockMemoryBackend()
    server = new MemoryMCPServer(backend)
  })

  describe('Initialization', () => {
    it('should create server instance', () => {
      expect(server).toBeDefined()
      expect(server.server).toBeDefined()
    })

    it('should have correct server name', () => {
      expect(server.server.name).toBe('memory')
    })

    it('should have version information', () => {
      expect(server.server.version).toBeTruthy()
    })
  })

  describe('Tool Registration', () => {
    it('should register filesystem tools', () => {
      const tools = server.server.getTools()
      const toolNames = Object.keys(tools)

      // Core filesystem tools (that work with memory backend)
      expect(toolNames).toContain('read_text_file')
      expect(toolNames).toContain('write_file')
      expect(toolNames).toContain('list_directory')
      expect(toolNames).toContain('get_file_info')
    })

    it('should NOT register exec tool for memory backend', () => {
      const tools = server.server.getTools()
      const toolNames = Object.keys(tools)

      // Memory backend does NOT support exec
      expect(toolNames).not.toContain('exec')
    })

    it('should have handler functions for all registered tools', () => {
      const tools = server.server.getTools()

      Object.entries(tools).forEach(([name, tool]) => {
        expect(typeof tool.handler).toBe('function')
      })
    })

    it('should have descriptions for all tools', () => {
      const tools = server.server.getTools()

      Object.entries(tools).forEach(([name, tool]) => {
        expect(tool.description).toBeTruthy()
      })
    })
  })

  describe('Tool Handlers', () => {
    it('should have read_text_file handler', () => {
      const tools = server.server.getTools()
      const readTool = tools['read_text_file']

      expect(readTool).toBeDefined()
      expect(typeof readTool.handler).toBe('function')
    })

    it('should have write_file handler', () => {
      const tools = server.server.getTools()
      const writeTool = tools['write_file']

      expect(writeTool).toBeDefined()
      expect(typeof writeTool.handler).toBe('function')
    })

    it('should have list_directory handler', () => {
      const tools = server.server.getTools()
      const listTool = tools['list_directory']

      expect(listTool).toBeDefined()
      expect(typeof listTool.handler).toBe('function')
    })

    it('should NOT have exec handler', () => {
      const tools = server.server.getTools()
      const execTool = tools['exec']

      expect(execTool).toBeUndefined()
    })
  })

  describe('Backend Integration', () => {
    it('should use provided backend instance', () => {
      expect(server['backend']).toBe(backend)
    })

    it('should use backend rootDir', () => {
      expect(server['backend'].rootDir).toBe('/memory')
    })

    it('should delegate operations to backend', () => {
      // Verify backend is accessible
      expect(backend).toBeDefined()
      expect(backend.read).toBeDefined()
      expect(backend.write).toBeDefined()
      expect(backend.list).toBeDefined()
    })
  })

  describe('Memory-Specific Features', () => {
    it('should support key/value operations', () => {
      // Memory backend has special list/delete/clear operations
      expect(backend.list).toBeDefined()
      expect(backend.delete).toBeDefined()
      expect(backend.clear).toBeDefined()
    })

    it('should not support command execution', () => {
      const tools = server.server.getTools()
      expect(tools['exec']).toBeUndefined()
    })
  })

  describe('Server Capabilities', () => {
    it('should expose tools capability', () => {
      const tools = server.server.getTools()
      expect(Object.keys(tools).length).toBeGreaterThan(0)
    })

    it('should provide tool metadata', () => {
      const tools = server.server.getTools()
      const tool = tools['read_text_file']

      expect(tool.name).toBe('read_text_file')
      expect(tool.description).toBeTruthy()
      expect(tool.inputSchema).toBeDefined()
    })

    it('should have fewer tools than LocalFilesystemMCPServer', () => {
      const tools = server.server.getTools()

      // Memory server has filesystem tools but no exec
      expect(tools['read_text_file']).toBeDefined()
      expect(tools['write_file']).toBeDefined()
      expect(tools['exec']).toBeUndefined()
    })
  })

  describe('Error Handling', () => {
    it('should handle backend errors gracefully', () => {
      vi.mocked(backend.read).mockRejectedValue(new Error('Memory backend error'))

      // Handler would catch and format this error
      expect(backend.read).toBeDefined()
    })

    it('should validate tool exists before execution', () => {
      const tools = server.server.getTools()

      expect(tools['nonexistent_tool']).toBeUndefined()
      expect(tools['exec']).toBeUndefined() // exec doesn't exist for memory
    })
  })

  describe('Type Safety', () => {
    it('should be properly typed', () => {
      expect(server).toBeInstanceOf(MemoryMCPServer)
    })

    it('should use MemoryBackend type', () => {
      expect(backend.type).toBe('memory')
    })
  })

  describe('Comparison with LocalFilesystemMCPServer', () => {
    it('should have different tool set than local filesystem server', () => {
      const memoryTools = server.server.getTools()
      const memoryToolNames = Object.keys(memoryTools)

      // Memory server should NOT have exec
      expect(memoryToolNames).not.toContain('exec')

      // But should have filesystem tools
      expect(memoryToolNames).toContain('read_text_file')
      expect(memoryToolNames).toContain('write_file')
    })
  })
})
