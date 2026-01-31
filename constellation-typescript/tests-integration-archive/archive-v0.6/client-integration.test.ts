import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { LocalFilesystemBackend } from '../../src/backends/LocalFilesystemBackend.js'
import { MemoryBackend } from '../../src/backends/MemoryBackend.js'
import { createTestLocalBackend, createTestMemoryBackend, cleanupBackend } from '../helpers/fixtures.js'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'

describe('MCP Client Integration', () => {
  describe('LocalFilesystemBackend MCP Client', () => {
    let backend: LocalFilesystemBackend
    let mcp: Client | null = null

    beforeEach(() => {
      backend = createTestLocalBackend()
    })

    afterEach(async () => {
      if (mcp) {
        await mcp.close()
        mcp = null
      }
      await cleanupBackend(backend)
    })

    it('should create MCP client', async () => {
      mcp = await backend.getMCPClient()
      expect(mcp).toBeDefined()
    })

    it('should list available tools', async () => {
      mcp = await backend.getMCPClient()
      const { tools } = await mcp.listTools()

      expect(tools).toBeDefined()
      expect(Array.isArray(tools)).toBe(true)

      // Should have filesystem tools
      const toolNames = tools.map(t => t.name)
      expect(toolNames).toContain('read_text_file')
      expect(toolNames).toContain('write_file')
      expect(toolNames).toContain('list_directory')

      // Should have exec tool (LocalFilesystemMCPServer includes it)
      expect(toolNames).toContain('exec')
    })

    it('should execute MCP tools', async () => {
      mcp = await backend.getMCPClient()

      // Write a file using MCP tool
      await mcp.callTool({
        name: 'write_file',
        arguments: {
          path: 'test.txt',
          content: 'Hello from MCP!'
        }
      })

      // Read it back
      const result = await mcp.callTool({
        name: 'read_text_file',
        arguments: {
          path: 'test.txt'
        }
      })

      expect(result.content).toBeDefined()
      expect(result.content[0]).toHaveProperty('text')
      expect(result.content[0].text).toContain('Hello from MCP!')
    })

    it('should execute commands via MCP exec tool', async () => {
      mcp = await backend.getMCPClient()

      await backend.write('test.txt', 'test content')

      const result = await mcp.callTool({
        name: 'exec',
        arguments: {
          command: 'cat test.txt'
        }
      })

      expect(result.content).toBeDefined()
      expect(result.content[0]).toHaveProperty('text')
      expect(result.content[0].text).toContain('test content')
    })

    it('should work with scoped MCP client', async () => {
      const scoped = backend.scope('workspace')
      mcp = await scoped.getMCPClient()

      await mcp.callTool({
        name: 'write_file',
        arguments: {
          path: 'scoped.txt',
          content: 'Scoped content'
        }
      })

      // Verify via backend API
      const content = await scoped.read('scoped.txt')
      expect(content).toBe('Scoped content')
    })
  })

  describe('MemoryBackend MCP Client', () => {
    let backend: MemoryBackend
    let mcp: Client | null = null

    beforeEach(() => {
      backend = createTestMemoryBackend()
    })

    afterEach(async () => {
      if (mcp) {
        await mcp.close()
        mcp = null
      }
      await cleanupBackend(backend)
    })

    it('should create MCP client', async () => {
      mcp = await backend.getMCPClient()
      expect(mcp).toBeDefined()
    })

    it('should list available tools', async () => {
      mcp = await backend.getMCPClient()
      const { tools } = await mcp.listTools()

      const toolNames = tools.map(t => t.name)

      // Should have filesystem tools
      expect(toolNames).toContain('read_text_file')
      expect(toolNames).toContain('write_file')
      expect(toolNames).toContain('list_directory')

      // Should NOT have exec tool (MemoryMCPServer excludes it)
      expect(toolNames).not.toContain('exec')
    })

    it('should execute MCP tools', async () => {
      mcp = await backend.getMCPClient()

      await mcp.callTool({
        name: 'write_file',
        arguments: {
          path: 'memory-key',
          content: 'Memory content'
        }
      })

      const result = await mcp.callTool({
        name: 'read_text_file',
        arguments: {
          path: 'memory-key'
        }
      })

      expect(result.content[0].text).toContain('Memory content')
    })

    it('should not have exec tool', async () => {
      mcp = await backend.getMCPClient()

      // Attempting to call exec should fail
      await expect(
        mcp.callTool({
          name: 'exec',
          arguments: {
            command: 'echo test'
          }
        })
      ).rejects.toThrow()
    })
  })

  describe('MCP Error Handling', () => {
    let backend: LocalFilesystemBackend
    let mcp: Client | null = null

    beforeEach(() => {
      backend = createTestLocalBackend()
    })

    afterEach(async () => {
      if (mcp) {
        await mcp.close()
        mcp = null
      }
      await cleanupBackend(backend)
    })

    it('should handle invalid tool calls', async () => {
      mcp = await backend.getMCPClient()

      await expect(
        mcp.callTool({
          name: 'nonexistent_tool',
          arguments: {}
        })
      ).rejects.toThrow()
    })

    it('should handle invalid arguments', async () => {
      mcp = await backend.getMCPClient()

      await expect(
        mcp.callTool({
          name: 'read_text_file',
          arguments: {
            // Missing required 'path' argument
          }
        })
      ).rejects.toThrow()
    })

    it('should handle file not found errors', async () => {
      mcp = await backend.getMCPClient()

      await expect(
        mcp.callTool({
          name: 'read_text_file',
          arguments: {
            path: 'nonexistent.txt'
          }
        })
      ).rejects.toThrow()
    })
  })
})
