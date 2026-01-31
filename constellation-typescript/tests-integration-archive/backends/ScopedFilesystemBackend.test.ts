import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { LocalFilesystemBackend } from '../../src/backends/LocalFilesystemBackend.js'
import { ScopedFilesystemBackend } from '../../src/backends/ScopedFilesystemBackend.js'
import { createTestLocalBackend, cleanupBackend, TEST_DATA } from '../helpers/fixtures.js'
import { PathEscapeError } from '../../src/types.js'

describe('ScopedFilesystemBackend', () => {
  let backend: LocalFilesystemBackend
  let scoped: ScopedFilesystemBackend<LocalFilesystemBackend>

  beforeEach(async () => {
    backend = createTestLocalBackend()

    // Create scope directory
    await backend.mkdir('users/user1', { recursive: true })
    scoped = backend.scope('users/user1') as ScopedFilesystemBackend<LocalFilesystemBackend>
  })

  afterEach(async () => {
    await cleanupBackend(backend)
  })

  describe('Construction & Validation', () => {
    it('should create scoped backend with correct rootDir', () => {
      expect(scoped.rootDir).toContain('users/user1')
      expect(scoped.scopePath).toBe('users/user1')
    })

    it('should inherit parent type', () => {
      expect(scoped.type).toBe(backend.type)
    })

    it('should inherit parent connection status', () => {
      expect(scoped.connected).toBe(backend.connected)
    })

    it('should handle absolute scopePaths as relative to root', () => {
      // Absolute paths are passed through and combined with parent rootDir
      const absScope = backend.scope('/etc/passwd') as ScopedFilesystemBackend<LocalFilesystemBackend>
      expect(absScope.scopePath).toBe('/etc/passwd')
      expect(absScope.rootDir).toContain('etc/passwd')
    })

    it('should reject paths that escape parent', () => {
      expect(() => backend.scope('../../../etc')).toThrow(PathEscapeError)
      expect(() => backend.scope('../../etc')).toThrow(PathEscapeError)
    })

    it('should allow valid relative scopePaths', () => {
      expect(() => backend.scope('valid/scope')).not.toThrow()
      expect(() => backend.scope('deeply/nested/scope')).not.toThrow()
    })
  })

  describe('Path Translation - Security Critical', () => {
    it('should treat absolute paths as relative to scope', async () => {
      // Absolute paths have leading slash stripped - treated as relative to scope
      // This means /etc/passwd becomes users/user1/etc/passwd (not system /etc/passwd)
      await scoped.write('/test.txt', 'content')
      expect(await scoped.exists('test.txt')).toBe(true)

      // Verify it's in the scoped directory
      expect(await backend.exists('users/user1/test.txt')).toBe(true)
    })

    it('should block parent directory escapes with ..', async () => {
      await expect(scoped.read('../../../etc/passwd')).rejects.toThrow(PathEscapeError)
      await expect(scoped.write('../../parent/file.txt', 'content')).rejects.toThrow(PathEscapeError)
    })

    it('should block complex escape sequences', async () => {
      await expect(scoped.read('foo/../../bar/../../../etc/passwd')).rejects.toThrow(PathEscapeError)
      await expect(scoped.write('a/../b/../../c/file.txt', 'content')).rejects.toThrow(PathEscapeError)
    })

    it('should allow valid relative paths within scope', async () => {
      await scoped.write('file.txt', 'content')
      await scoped.write('subdir/file.txt', 'content')
      await scoped.write('deeply/nested/path/file.txt', 'content')

      expect(await scoped.exists('file.txt')).toBe(true)
      expect(await scoped.exists('subdir/file.txt')).toBe(true)
      expect(await scoped.exists('deeply/nested/path/file.txt')).toBe(true)
    })

    it('should normalize . (current directory) correctly', async () => {
      await scoped.write('./file.txt', 'content')
      expect(await scoped.exists('file.txt')).toBe(true)
    })

    it('should handle multiple .. segments correctly', async () => {
      // Valid: go down then back up within scope
      await scoped.mkdir('a/b/c', { recursive: true })
      await scoped.write('a/b/c/file.txt', 'content')

      // This should work: a/b/c/../file.txt = a/b/file.txt
      await scoped.write('a/b/c/../file2.txt', 'content2')
      expect(await scoped.exists('a/b/file2.txt')).toBe(true)

      // This should fail: escapes scope
      await expect(scoped.read('a/../../outside.txt')).rejects.toThrow(PathEscapeError)
    })
  })

  describe('File Operations Delegation', () => {
    it('should read files through parent', async () => {
      await scoped.write('test.txt', TEST_DATA.simpleFile)
      const content = await scoped.read('test.txt')
      expect(content).toBe(TEST_DATA.simpleFile)
    })

    it('should write files through parent', async () => {
      await scoped.write('new.txt', 'hello')

      // Verify through parent backend
      const content = await backend.read('users/user1/new.txt')
      expect(content).toBe('hello')
    })

    it('should list directory through parent', async () => {
      await scoped.write('file1.txt', 'content1')
      await scoped.write('file2.txt', 'content2')
      await scoped.mkdir('subdir')

      const files = await scoped.readdir('.')
      expect(files).toContain('file1.txt')
      expect(files).toContain('file2.txt')
      expect(files).toContain('subdir')
    })

    it('should create directories through parent', async () => {
      await scoped.mkdir('nested/deeply', { recursive: true })
      expect(await scoped.exists('nested/deeply')).toBe(true)
    })

    it('should touch files through parent', async () => {
      await scoped.touch('empty.txt')
      expect(await scoped.exists('empty.txt')).toBe(true)

      const content = await scoped.read('empty.txt')
      expect(content).toBe('')
    })

    it('should check existence through parent', async () => {
      await scoped.write('exists.txt', 'content')

      expect(await scoped.exists('exists.txt')).toBe(true)
      expect(await scoped.exists('nonexistent.txt')).toBe(false)
    })

    it('should get stats through parent', async () => {
      await scoped.write('test.txt', 'content')

      const stats = await scoped.stat('test.txt')
      expect(stats.isFile()).toBe(true)
      expect(stats.size).toBeGreaterThan(0)
    })

    it('should maintain scope boundary for all operations', async () => {
      // Create file in parent outside scope
      await backend.write('users/user2/secret.txt', 'secret data')

      // Scoped backend should not be able to access it
      await expect(scoped.read('../user2/secret.txt')).rejects.toThrow(PathEscapeError)
      await expect(scoped.exists('../user2/secret.txt')).rejects.toThrow(PathEscapeError)
    })
  })

  describe('Command Execution', () => {
    it('should execute commands in scoped directory', async () => {
      await scoped.write('test.txt', 'scoped content')

      const output = await scoped.exec('ls -la')
      expect(output.toString()).toContain('test.txt')
    })

    it('should set correct working directory', async () => {
      const output = await scoped.exec('pwd')
      expect(output.toString()).toContain('users/user1')
    })

    it('should respect parent isolation mode', async () => {
      // Commands should execute within the scoped directory
      await scoped.write('file.txt', 'content')

      const output = await scoped.exec('cat file.txt')
      expect(output.toString().trim()).toBe('content')
    })

    it('should merge environment variables', async () => {
      const scopedWithEnv = backend.scope('users/user1', {
        env: { TEST_VAR: 'scoped-value' }
      }) as ScopedFilesystemBackend<LocalFilesystemBackend>

      const output = await scopedWithEnv.exec('echo $TEST_VAR')
      expect(output.toString().trim()).toBe('scoped-value')
    })

    it('should merge command-specific env with scope env', async () => {
      const scopedWithEnv = backend.scope('users/user1', {
        env: { VAR1: 'scope-value' }
      }) as ScopedFilesystemBackend<LocalFilesystemBackend>

      const output = await scopedWithEnv.exec('echo $VAR1 $VAR2', {
        env: { VAR2: 'command-value' }
      })

      expect(output.toString()).toContain('scope-value')
      expect(output.toString()).toContain('command-value')
    })
  })

  describe('Environment Variables', () => {
    it('should pass custom env to scoped backend', async () => {
      const scopedWithEnv = backend.scope('users/user1', {
        env: {
          NODE_ENV: 'production',
          API_KEY: 'secret-key'
        }
      }) as ScopedFilesystemBackend<LocalFilesystemBackend>

      const output = await scopedWithEnv.exec('echo $NODE_ENV')
      expect(output.toString().trim()).toBe('production')
    })

    it('should override parent env for same keys', async () => {
      const scopedWithEnv = backend.scope('users/user1', {
        env: { OVERRIDE: 'scope-value' }
      }) as ScopedFilesystemBackend<LocalFilesystemBackend>

      const output = await scopedWithEnv.exec('echo $OVERRIDE', {
        env: { OVERRIDE: 'command-value' }
      })

      // Command env should override scope env
      expect(output.toString().trim()).toBe('command-value')
    })

    it('should not modify parent backend env', async () => {
      const scopedWithEnv = backend.scope('users/user1', {
        env: { SCOPED_VAR: 'scoped' }
      }) as ScopedFilesystemBackend<LocalFilesystemBackend>

      // Execute in scoped backend
      await scopedWithEnv.exec('echo $SCOPED_VAR')

      // Parent should not have scoped env
      const parentOutput = await backend.exec('echo $SCOPED_VAR')
      expect(parentOutput.toString().trim()).toBe('')
    })
  })

  describe('Nested Scoping', () => {
    it('should create nested scoped backend', async () => {
      await scoped.mkdir('projects/my-app', { recursive: true })

      const nested = scoped.scope('projects/my-app')
      expect(nested).toBeInstanceOf(ScopedFilesystemBackend)
    })

    it('should combine scope paths correctly', async () => {
      await scoped.mkdir('projects/my-app', { recursive: true })

      const nested = scoped.scope('projects/my-app') as ScopedFilesystemBackend<LocalFilesystemBackend>
      expect(nested.scopePath).toBe('users/user1/projects/my-app')
    })

    it('should cascade environment variables', async () => {
      const level1 = backend.scope('users/user1', {
        env: { LEVEL: '1', VAR1: 'value1' }
      }) as ScopedFilesystemBackend<LocalFilesystemBackend>

      await level1.mkdir('projects', { recursive: true })

      const level2 = level1.scope('projects', {
        env: { LEVEL: '2', VAR2: 'value2' }
      }) as ScopedFilesystemBackend<LocalFilesystemBackend>

      const output = await level2.exec('echo $LEVEL $VAR1 $VAR2')

      // LEVEL should be overridden to '2'
      expect(output.toString()).toContain('2')
      // VAR1 should be inherited
      expect(output.toString()).toContain('value1')
      // VAR2 should be added
      expect(output.toString()).toContain('value2')
    })

    it('should prevent escapes at any nesting level', async () => {
      await scoped.mkdir('projects/my-app', { recursive: true })

      const nested = scoped.scope('projects/my-app')

      // Should not be able to escape to user1 or parent
      await expect(nested.read('../../secret.txt')).rejects.toThrow(PathEscapeError)
      await expect(nested.read('../../../user2/file.txt')).rejects.toThrow(PathEscapeError)
    })

    it('should work with three-level nesting', async () => {
      await scoped.mkdir('a/b/c', { recursive: true })

      const level1 = scoped.scope('a') as ScopedFilesystemBackend<LocalFilesystemBackend>
      const level2 = level1.scope('b') as ScopedFilesystemBackend<LocalFilesystemBackend>
      const level3 = level2.scope('c') as ScopedFilesystemBackend<LocalFilesystemBackend>

      await level3.write('deep.txt', 'deep content')

      // Verify through parent
      expect(await backend.exists('users/user1/a/b/c/deep.txt')).toBe(true)

      // Verify through intermediate scopes
      expect(await level1.exists('b/c/deep.txt')).toBe(true)
      expect(await level2.exists('c/deep.txt')).toBe(true)
    })

    it('should maintain isolation in nested scopes', async () => {
      await backend.mkdir('users/user1/project1', { recursive: true })
      await backend.mkdir('users/user1/project2', { recursive: true })

      const project1 = scoped.scope('project1')
      const project2 = scoped.scope('project2')

      await project1.write('secret.txt', 'project1 secret')

      // project2 should not be able to access project1's files
      await expect(project2.read('../project1/secret.txt')).rejects.toThrow(PathEscapeError)
    })
  })

  describe('Scope Management', () => {
    it('should list immediate subdirectories only', async () => {
      await scoped.mkdir('project1', { recursive: true })
      await scoped.mkdir('project2', { recursive: true })
      await scoped.mkdir('project1/subdir', { recursive: true })
      await scoped.write('file.txt', 'content')

      const scopes = await scoped.listScopes()

      expect(scopes).toContain('project1')
      expect(scopes).toContain('project2')
      expect(scopes).not.toContain('file.txt') // Not a directory
      expect(scopes).not.toContain('subdir') // Nested, not immediate
    })

    it('should return empty array when no subdirectories', async () => {
      await scoped.write('file1.txt', 'content')
      await scoped.write('file2.txt', 'content')

      const scopes = await scoped.listScopes()
      expect(scopes).toEqual([])
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
      await scoped.mkdir('projects/my-app', { recursive: true })

      const client = await scoped.getMCPClient('projects/my-app')
      expect(client).toBeDefined()

      await client.close()
    })

    it.skip('should execute MCP tools in scoped directory', async () => {
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

  describe('Binary Data', () => {
    it('should handle binary data in scoped operations', async () => {
      await scoped.write('image.png', TEST_DATA.binaryData)

      const content = await scoped.read('image.png', { encoding: 'buffer' })
      expect(Buffer.isBuffer(content)).toBe(true)
      expect(content).toEqual(TEST_DATA.binaryData)
    })
  })

  describe('Multi-tenant Isolation', () => {
    it('should isolate multiple user scopes', async () => {
      // Create two user scopes
      await backend.mkdir('users/user1', { recursive: true })
      await backend.mkdir('users/user2', { recursive: true })

      const user1 = backend.scope('users/user1') as ScopedFilesystemBackend<LocalFilesystemBackend>
      const user2 = backend.scope('users/user2') as ScopedFilesystemBackend<LocalFilesystemBackend>

      // User1 creates file
      await user1.write('private.txt', 'user1 private data')

      // User2 should not be able to access it
      await expect(user2.read('../user1/private.txt')).rejects.toThrow(PathEscapeError)
      await expect(user2.exists('../user1/private.txt')).rejects.toThrow(PathEscapeError)
    })

    it('should prevent command execution across user scopes', async () => {
      await backend.mkdir('users/user1', { recursive: true })
      await backend.mkdir('users/user2', { recursive: true })

      const user1 = backend.scope('users/user1') as ScopedFilesystemBackend<LocalFilesystemBackend>
      const user2 = backend.scope('users/user2') as ScopedFilesystemBackend<LocalFilesystemBackend>

      await user1.write('secret.txt', 'secret')

      // User2 shouldn't be able to use .. in commands (safety check blocks it)
      await expect(user2.exec('cat ../user1/secret.txt')).rejects.toThrow()
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty path as current directory', async () => {
      await scoped.write('file.txt', 'content')

      const files = await scoped.readdir('')
      expect(files).toContain('file.txt')
    })

    it('should handle . as current directory', async () => {
      await scoped.write('file.txt', 'content')

      const files = await scoped.readdir('.')
      expect(files).toContain('file.txt')
    })

    it('should normalize complex valid paths', async () => {
      await scoped.mkdir('a/b', { recursive: true })
      await scoped.write('a/b/file.txt', 'content')

      // ./a/./b/../b/file.txt should normalize to a/b/file.txt
      const content = await scoped.read('./a/./b/../b/file.txt')
      expect(content).toBe('content')
    })
  })
})
