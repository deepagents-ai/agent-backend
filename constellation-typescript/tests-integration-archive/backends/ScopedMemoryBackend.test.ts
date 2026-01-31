import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MemoryBackend } from '../../src/backends/MemoryBackend.js'
import { ScopedMemoryBackend } from '../../src/backends/ScopedMemoryBackend.js'
import { createTestMemoryBackend, cleanupBackend, TEST_DATA } from '../helpers/fixtures.js'
import { PathEscapeError, NotImplementedError } from '../../src/types.js'

describe('ScopedMemoryBackend', () => {
  let backend: MemoryBackend
  let scoped: ScopedMemoryBackend<MemoryBackend>

  beforeEach(() => {
    backend = createTestMemoryBackend()
    scoped = backend.scope('users/user1/') as ScopedMemoryBackend<MemoryBackend>
  })

  afterEach(async () => {
    await cleanupBackend(backend)
  })

  describe('Construction & Validation', () => {
    it('should create scoped backend with correct scope path', () => {
      expect(scoped.scopePath).toBe('users/user1/')
      expect(scoped.rootDir).toBe('users/user1/')
    })

    it('should normalize scope path with trailing slash', () => {
      const scoped1 = backend.scope('test') as ScopedMemoryBackend<MemoryBackend>
      const scoped2 = backend.scope('test/') as ScopedMemoryBackend<MemoryBackend>

      expect(scoped1.scopePath).toBe('test/')
      expect(scoped2.scopePath).toBe('test/')
    })

    it('should inherit parent type', () => {
      expect(scoped.type).toBe(backend.type)
    })

    it('should inherit parent connection status', () => {
      expect(scoped.connected).toBe(backend.connected)
    })
  })

  describe('Key Translation', () => {
    it('should prepend scope prefix to keys', async () => {
      await scoped.write('test.txt', 'content')

      // Verify key is scoped in parent
      const keys = await backend.list('users/user1/')
      expect(keys).toContain('users/user1/test.txt')
    })

    it('should handle absolute paths in key names as relative', async () => {
      // Absolute paths are treated as relative (leading slash stripped)
      await scoped.write('/test.txt', 'content')

      // Should be stored as users/user1/test.txt
      expect(await backend.exists('users/user1/test.txt')).toBe(true)
    })

    it('should block directory escapes with ..', async () => {
      await expect(scoped.write('../../../outside.txt', 'content')).rejects.toThrow(PathEscapeError)
      await expect(scoped.read('../../parent.txt')).rejects.toThrow(PathEscapeError)
    })

    it('should block complex escape sequences', async () => {
      await expect(scoped.write('foo/../../bar/../../../etc/passwd', 'content')).rejects.toThrow(PathEscapeError)
    })

    it('should allow valid relative keys within scope', async () => {
      await scoped.write('file.txt', 'content1')
      await scoped.write('subdir/file.txt', 'content2')
      await scoped.write('deeply/nested/key.txt', 'content3')

      expect(await scoped.exists('file.txt')).toBe(true)
      expect(await scoped.exists('subdir/file.txt')).toBe(true)
      expect(await scoped.exists('deeply/nested/key.txt')).toBe(true)
    })
  })

  describe('Key/Value Operations', () => {
    it('should write and read string values', async () => {
      await scoped.write('key1', TEST_DATA.simpleFile)
      const value = await scoped.read('key1')

      expect(value).toBe(TEST_DATA.simpleFile)
    })

    it('should write and read buffer values', async () => {
      await scoped.write('binary', TEST_DATA.binaryData)
      const value = await scoped.read('binary', { encoding: 'buffer' })

      expect(Buffer.isBuffer(value)).toBe(true)
      expect(value).toEqual(TEST_DATA.binaryData)
    })

    it('should check if key exists', async () => {
      await scoped.write('exists', 'value')

      expect(await scoped.exists('exists')).toBe(true)
      expect(await scoped.exists('nonexistent')).toBe(false)
    })

    it('should get stats for key', async () => {
      await scoped.write('key', 'value')

      const stats = await scoped.stat('key')
      expect(stats).toBeDefined()
      expect(stats.isFile()).toBe(true)
    })

    it('should touch keys', async () => {
      await scoped.touch('empty')

      expect(await scoped.exists('empty')).toBe(true)
      const value = await scoped.read('empty')
      expect(value).toBe('')
    })

    it('should throw on non-existent key read', async () => {
      await expect(scoped.read('nonexistent')).rejects.toThrow()
    })
  })

  describe('Directory Simulation', () => {
    it('should list immediate children only', async () => {
      await scoped.write('file1.txt', 'content1')
      await scoped.write('file2.txt', 'content2')
      await scoped.write('subdir/file3.txt', 'content3')

      const keys = await scoped.readdir('')
      // readdir returns immediate children only (not nested)
      expect(keys).toContain('file1.txt')
      expect(keys).toContain('file2.txt')
      expect(keys).toContain('subdir') // Directory, not full path
      expect(keys).not.toContain('subdir/file3.txt') // Nested file not included
    })

    it('should return children without scope prefix', async () => {
      await scoped.write('test.txt', 'content')

      const keys = await scoped.readdir('')

      // Should return immediate children without scope prefix
      expect(keys).toContain('test.txt')
      expect(keys).not.toContain('users/user1/test.txt')
    })

    it('should list immediate children in subdirectory', async () => {
      await scoped.write('dir1/file1.txt', 'content1')
      await scoped.write('dir1/file2.txt', 'content2')
      await scoped.write('dir2/file3.txt', 'content3')

      const keys = await scoped.readdir('dir1/')
      // Returns immediate children of dir1 only
      expect(keys).toContain('file1.txt')
      expect(keys).toContain('file2.txt')
      expect(keys).not.toContain('file3.txt') // In dir2, not dir1
    })

    it('should handle mkdir as no-op', async () => {
      await scoped.mkdir('directory', { recursive: true })
      // Should not throw, but is a no-op for memory
    })
  })

  describe('Memory-Specific Operations', () => {
    it('should list all keys with prefix', async () => {
      await scoped.write('app/config.json', 'config')
      await scoped.write('app/state.json', 'state')
      await scoped.write('data/file.txt', 'data')

      const appKeys = await scoped.list('app/')
      expect(appKeys).toContain('app/config.json')
      expect(appKeys).toContain('app/state.json')
      expect(appKeys).not.toContain('data/file.txt')
    })

    it('should list all keys without prefix', async () => {
      await scoped.write('key1', 'value1')
      await scoped.write('key2', 'value2')
      await scoped.write('dir/key3', 'value3')

      const allKeys = await scoped.list()
      expect(allKeys.length).toBeGreaterThanOrEqual(3)
      expect(allKeys).toContain('key1')
      expect(allKeys).toContain('key2')
      expect(allKeys).toContain('dir/key3')
    })

    it('should delete single key', async () => {
      await scoped.write('delete-me', 'value')
      expect(await scoped.exists('delete-me')).toBe(true)

      await scoped.delete('delete-me')
      expect(await scoped.exists('delete-me')).toBe(false)
    })

    it('should clear all keys in scope', async () => {
      await scoped.write('key1', 'value1')
      await scoped.write('key2', 'value2')
      await scoped.write('dir/key3', 'value3')

      await scoped.clear()

      const keys = await scoped.list()
      expect(keys).toEqual([])
    })

    it('should not affect parent keys when clearing scope', async () => {
      // Create keys in parent
      await backend.write('global/key', 'global value')

      // Create keys in scope
      await scoped.write('scoped/key', 'scoped value')

      // Clear scope
      await scoped.clear()

      // Parent key should still exist
      expect(await backend.exists('global/key')).toBe(true)

      // Scoped key should be gone
      expect(await scoped.exists('scoped/key')).toBe(false)
    })
  })

  describe('Command Execution', () => {
    it('should throw NotImplementedError for exec', async () => {
      await expect(scoped.exec('echo test')).rejects.toThrow(NotImplementedError)
    })

    it('should provide clear error message for exec', async () => {
      try {
        await scoped.exec('ls')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(NotImplementedError)
        expect((error as Error).message).toContain('exec')
        expect((error as Error).message).toContain('memory')
      }
    })
  })

  describe('Nested Scoping', () => {
    it('should create nested scoped backend', () => {
      const nested = scoped.scope('projects/my-app')
      expect(nested).toBeInstanceOf(ScopedMemoryBackend)
    })

    it('should combine scope prefixes correctly', () => {
      const nested = scoped.scope('projects/my-app') as ScopedMemoryBackend<MemoryBackend>
      expect(nested.scopePath).toContain('users/user1/')
      expect(nested.scopePath).toContain('projects/my-app')
    })

    it('should maintain isolation in nested scopes', async () => {
      const nested1 = scoped.scope('project1') as ScopedMemoryBackend<MemoryBackend>
      const nested2 = scoped.scope('project2') as ScopedMemoryBackend<MemoryBackend>

      await nested1.write('secret.txt', 'project1 secret')

      // nested2 should not be able to access nested1's keys
      await expect(nested2.read('../project1/secret.txt')).rejects.toThrow(PathEscapeError)
    })

    it('should work with multiple nesting levels', async () => {
      const level1 = scoped.scope('a') as ScopedMemoryBackend<MemoryBackend>
      const level2 = level1.scope('b') as ScopedMemoryBackend<MemoryBackend>
      const level3 = level2.scope('c') as ScopedMemoryBackend<MemoryBackend>

      await level3.write('deep.txt', 'deep value')

      // Verify through parent
      expect(await backend.exists('users/user1/a/b/c/deep.txt')).toBe(true)

      // Verify through intermediate scopes
      expect(await level1.exists('b/c/deep.txt')).toBe(true)
      expect(await level2.exists('c/deep.txt')).toBe(true)
    })

    it('should prevent escapes at any nesting level', async () => {
      const nested = scoped.scope('projects/my-app')

      await expect(nested.read('../../outside.txt')).rejects.toThrow(PathEscapeError)
      await expect(nested.write('../../../global.txt', 'content')).rejects.toThrow(PathEscapeError)
    })
  })

  describe('Scope Management', () => {
    it('should list scopes within scope', async () => {
      await scoped.write('project1/file.txt', 'content1')
      await scoped.write('project2/file.txt', 'content2')
      await scoped.write('file.txt', 'content')

      const scopes = await scoped.listScopes()

      expect(scopes).toContain('project1')
      expect(scopes).toContain('project2')
    })

    it('should return empty array when no scopes', async () => {
      await scoped.write('file1.txt', 'content1')
      await scoped.write('file2.txt', 'content2')

      const scopes = await scoped.listScopes()
      expect(scopes).toEqual([])
    })

    it('should only return immediate scopes', async () => {
      await scoped.write('a/file.txt', 'content')
      await scoped.write('a/b/file.txt', 'content')
      await scoped.write('c/file.txt', 'content')

      const scopes = await scoped.listScopes()

      expect(scopes).toContain('a')
      expect(scopes).toContain('c')
      expect(scopes).not.toContain('b') // Nested under 'a'
    })
  })

  describe('MCP Client Integration', () => {
    it.skip('should create MCP client for scoped backend', async () => {
      // Skipped: requires agentbe-server to be installed and in PATH
      const client = await scoped.getMCPClient()
      expect(client).toBeDefined()

      await client.close()
    })

    it.skip('should create MCP client with additional scope path', async () => {
      // Skipped: requires agentbe-server to be installed and in PATH
      const client = await scoped.getMCPClient('projects/my-app')
      expect(client).toBeDefined()

      await client.close()
    })

    it.skip('should execute MCP tools in scoped keys', async () => {
      // Skipped: requires agentbe-server to be installed and in PATH
      const client = await scoped.getMCPClient()

      try {
        // Write through MCP
        await client.callTool({
          name: 'write_file',
          arguments: { path: 'mcp-test.txt', content: 'MCP content' }
        })

        // Verify through backend
        expect(await scoped.exists('mcp-test.txt')).toBe(true)
        const content = await scoped.read('mcp-test.txt')
        expect(content).toBe('MCP content')
      } finally {
        await client.close()
      }
    })
  })

  describe('Multi-tenant Isolation', () => {
    it('should isolate multiple user scopes', async () => {
      const user1 = backend.scope('users/user1/') as ScopedMemoryBackend<MemoryBackend>
      const user2 = backend.scope('users/user2/') as ScopedMemoryBackend<MemoryBackend>

      await user1.write('private.txt', 'user1 private data')

      // User2 should not be able to access it
      await expect(user2.read('../user1/private.txt')).rejects.toThrow(PathEscapeError)
    })

    it('should maintain separate key spaces per user', async () => {
      const user1 = backend.scope('users/user1/') as ScopedMemoryBackend<MemoryBackend>
      const user2 = backend.scope('users/user2/') as ScopedMemoryBackend<MemoryBackend>

      await user1.write('config.json', 'user1 config')
      await user2.write('config.json', 'user2 config')

      const user1Config = await user1.read('config.json')
      const user2Config = await user2.read('config.json')

      expect(user1Config).toBe('user1 config')
      expect(user2Config).toBe('user2 config')
    })

    it('should list only keys within scope', async () => {
      const user1 = backend.scope('users/user1/') as ScopedMemoryBackend<MemoryBackend>
      const user2 = backend.scope('users/user2/') as ScopedMemoryBackend<MemoryBackend>

      await user1.write('file1.txt', 'content1')
      await user2.write('file2.txt', 'content2')

      const user1Keys = await user1.list()
      const user2Keys = await user2.list()

      expect(user1Keys).toContain('file1.txt')
      expect(user1Keys).not.toContain('file2.txt')

      expect(user2Keys).toContain('file2.txt')
      expect(user2Keys).not.toContain('file1.txt')
    })

    it('should clear only scoped keys', async () => {
      const user1 = backend.scope('users/user1/') as ScopedMemoryBackend<MemoryBackend>
      const user2 = backend.scope('users/user2/') as ScopedMemoryBackend<MemoryBackend>

      await user1.write('file.txt', 'user1')
      await user2.write('file.txt', 'user2')

      await user1.clear()

      expect(await user1.exists('file.txt')).toBe(false)
      expect(await user2.exists('file.txt')).toBe(true)
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty key as scope root', async () => {
      await scoped.write('root.txt', 'content')

      const keys = await scoped.list('')
      expect(keys).toContain('root.txt')
    })

    it('should handle keys with special characters', async () => {
      await scoped.write('file-name_123.json', 'content')
      expect(await scoped.exists('file-name_123.json')).toBe(true)
    })

    it('should handle deeply nested keys', async () => {
      const deepKey = 'a/b/c/d/e/f/g/h/i/j/deep.txt'
      await scoped.write(deepKey, 'deep content')

      expect(await scoped.exists(deepKey)).toBe(true)
      const content = await scoped.read(deepKey)
      expect(content).toBe('deep content')
    })

    it('should normalize complex valid keys', async () => {
      await scoped.write('a/b/file.txt', 'content')

      // ./a/./b/../b/file.txt should normalize to a/b/file.txt
      const content = await scoped.read('./a/./b/../b/file.txt')
      expect(content).toBe('content')
    })
  })

  describe('JSON Data', () => {
    it('should store and retrieve JSON data', async () => {
      const jsonData = JSON.stringify(TEST_DATA.jsonData)
      await scoped.write('data.json', jsonData)

      const retrieved = await scoped.read('data.json')
      expect(JSON.parse(retrieved as string)).toEqual(TEST_DATA.jsonData)
    })

    it('should handle complex nested JSON', async () => {
      const complex = {
        users: {
          user1: { name: 'Alice', age: 30 },
          user2: { name: 'Bob', age: 25 }
        },
        settings: {
          theme: 'dark',
          notifications: true
        }
      }

      await scoped.write('complex.json', JSON.stringify(complex))
      const retrieved = await scoped.read('complex.json')
      expect(JSON.parse(retrieved as string)).toEqual(complex)
    })
  })
})
