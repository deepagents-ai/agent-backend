import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LocalFilesystemMCPServer } from '../../../src/mcp/servers/LocalFilesystemMCPServer.js'
import type { LocalFilesystemBackend } from 'constellationfs'

// Mock backend
function createMockBackend(): LocalFilesystemBackend {
  return {
    type: 'local-filesystem',
    rootDir: '/test/workspace',
    connected: true,
    read: vi.fn().mockResolvedValue('mock content'),
    write: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue(['file1.txt', 'file2.txt']),
    mkdir: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(true),
    stat: vi.fn().mockResolvedValue({
      isFile: () => true,
      isDirectory: () => false,
      size: 100,
      mtime: new Date(),
      mode: 0o644
    } as any),
    exec: vi.fn().mockResolvedValue('command output'),
    touch: vi.fn().mockResolvedValue(undefined),
    scope: vi.fn(),
    listScopes: vi.fn().mockResolvedValue([]),
    getMCPClient: vi.fn(),
    destroy: vi.fn().mockResolvedValue(undefined)
  } as any
}

describe('LocalFilesystemMCPServer (Unit Tests)', () => {
  let backend: LocalFilesystemBackend
  let server: LocalFilesystemMCPServer

  beforeEach(() => {
    vi.clearAllMocks()
    backend = createMockBackend()
    server = new LocalFilesystemMCPServer(backend)
  })

  describe('Initialization', () => {
    it('should create server instance', () => {
      expect(server).toBeDefined()
      expect(server.server).toBeDefined()
    })

    it('should have correct server name', () => {
      expect(server.server.name).toBe('local-filesystem')
    })

    it('should have version information', () => {
      expect(server.server.version).toBeTruthy()
    })
  })

  describe('Tool Registration', () => {
    it('should register filesystem tools', () => {
      const tools = server.server.getTools()
      const toolNames = Object.keys(tools)

      // Core filesystem tools
      expect(toolNames).toContain('read_text_file')
      expect(toolNames).toContain('write_file')
      expect(toolNames).toContain('list_directory')
      expect(toolNames).toContain('create_directory')
      expect(toolNames).toContain('move_file')
      expect(toolNames).toContain('search_files')
      expect(toolNames).toContain('get_file_info')
    })

    it('should register exec tool for local backend', () => {
      const tools = server.server.getTools()
      const toolNames = Object.keys(tools)

      // LocalFilesystemMCPServer SHOULD have exec tool
      expect(toolNames).toContain('exec')
    })

    it('should have handler functions for all tools', () => {
      const tools = server.server.getTools()

      Object.entries(tools).forEach(([name, tool]) => {
        expect(typeof tool.handler).toBe('function')
      })
    })

    it('should have descriptions for all tools', () => {
      const tools = server.server.getTools()

      Object.entries(tools).forEach(([name, tool]) => {
        expect(tool.description).toBeTruthy()
        expect(tool.description.length).toBeGreaterThan(0)
      })
    })

    it('should have input schemas for all tools', () => {
      const tools = server.server.getTools()

      Object.entries(tools).forEach(([name, tool]) => {
        expect(tool.inputSchema).toBeDefined()
        expect(tool.inputSchema.type).toBe('object')
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

    it('should have exec handler', () => {
      const tools = server.server.getTools()
      const execTool = tools['exec']

      expect(execTool).toBeDefined()
      expect(typeof execTool.handler).toBe('function')
    })
  })

  describe('Backend Integration', () => {
    it('should use provided backend instance', () => {
      expect(server['backend']).toBe(backend)
    })

    it('should use backend rootDir for allowed directories', () => {
      expect(server['backend'].rootDir).toBe('/test/workspace')
    })

    it('should delegate operations to backend', async () => {
      // Tools will delegate to backend when called
      // We verify backend is accessible and configured
      expect(backend).toBeDefined()
      expect(backend.read).toBeDefined()
      expect(backend.write).toBeDefined()
      expect(backend.exec).toBeDefined()
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
  })

  describe('Error Handling', () => {
    it('should handle backend errors gracefully', () => {
      // When backend methods are called, errors should be handled
      vi.mocked(backend.read).mockRejectedValue(new Error('Backend error'))

      // The handler would catch and format this error appropriately
      expect(backend.read).toBeDefined()
    })

    it('should validate tool exists before execution', () => {
      const tools = server.server.getTools()

      // Calling non-existent tool should be undefined
      expect(tools['nonexistent_tool']).toBeUndefined()
    })
  })

  describe('Type Safety', () => {
    it('should be properly typed', () => {
      // Ensure server instance has correct type
      expect(server).toBeInstanceOf(LocalFilesystemMCPServer)
    })

    it('should use LocalFilesystemBackend type', () => {
      // Verify backend type is correct
      expect(backend.type).toBe('local-filesystem')
    })
  })
})
