import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { LocalFilesystemBackend } from '../../src/backends/LocalFilesystemBackend.js'
import { createTestLocalBackend, cleanupBackend, TEST_DATA } from '../helpers/fixtures.js'
import { BackendError, DangerousOperationError } from '../../src/types.js'

describe('LocalFilesystemBackend', () => {
  let backend: LocalFilesystemBackend

  beforeEach(() => {
    backend = createTestLocalBackend()
  })

  afterEach(async () => {
    await cleanupBackend(backend)
  })

  describe('Basic Operations', () => {
    it('should write and read a file', async () => {
      await backend.write('test.txt', TEST_DATA.simpleFile)
      const content = await backend.read('test.txt')
      expect(content).toBe(TEST_DATA.simpleFile)
    })

    it('should write and read binary data', async () => {
      await backend.write('image.png', TEST_DATA.binaryData)
      const content = await backend.read('image.png', { encoding: 'buffer' })
      expect(Buffer.isBuffer(content)).toBe(true)
      expect(content).toEqual(TEST_DATA.binaryData)
    })

    it('should create directories', async () => {
      await backend.mkdir('subdir/nested', { recursive: true })
      await backend.write('subdir/nested/file.txt', 'content')
      const content = await backend.read('subdir/nested/file.txt')
      expect(content).toBe('content')
    })

    it('should list directory contents', async () => {
      await backend.write('file1.txt', 'content1')
      await backend.write('file2.txt', 'content2')
      await backend.mkdir('subdir')

      const files = await backend.readdir('.')
      expect(files).toContain('file1.txt')
      expect(files).toContain('file2.txt')
      expect(files).toContain('subdir')
    })

    it('should check if file exists', async () => {
      await backend.write('exists.txt', 'content')

      expect(await backend.exists('exists.txt')).toBe(true)
      expect(await backend.exists('nonexistent.txt')).toBe(false)
    })

    it('should get file stats', async () => {
      const content = 'Hello, World!'
      await backend.write('test.txt', content)

      const stats = await backend.stat('test.txt')
      expect(stats.isFile()).toBe(true)
      expect(stats.size).toBeGreaterThan(0)
    })

    it('should touch a file', async () => {
      await backend.touch('empty.txt')
      expect(await backend.exists('empty.txt')).toBe(true)

      const content = await backend.read('empty.txt')
      expect(content).toBe('')
    })
  })

  describe('Command Execution', () => {
    it('should execute simple commands', async () => {
      await backend.write('test.txt', 'content')
      const output = await backend.exec('ls -la')
      expect(output).toContain('test.txt')
    })

    it('should execute commands with output', async () => {
      const output = await backend.exec('echo "Hello from exec"')
      expect(output.toString().trim()).toBe('Hello from exec')
    })

    it('should handle command errors', async () => {
      await expect(backend.exec('nonexistent-command')).rejects.toThrow()
    })

    it('should block dangerous commands by default', async () => {
      for (const cmd of TEST_DATA.dangerousCommands) {
        await expect(backend.exec(cmd)).rejects.toThrow(DangerousOperationError)
      }
    })

    it('should allow dangerous commands when preventDangerous is false', async () => {
      const unsafeBackend = createTestLocalBackend({ preventDangerous: false })

      try {
        // This won't actually harm anything in the sandboxed workspace
        const output = await unsafeBackend.exec('echo "dangerous" > /tmp/test.txt')
        expect(output).toBeDefined()
      } finally {
        await cleanupBackend(unsafeBackend)
      }
    })
  })

  describe('Path Security', () => {
    it('should block absolute paths', async () => {
      await expect(backend.read('/etc/passwd')).rejects.toThrow(BackendError)
    })

    it('should block parent directory traversal', async () => {
      await expect(backend.read('../../../etc/passwd')).rejects.toThrow(BackendError)
    })

    it('should block home directory expansion', async () => {
      await expect(backend.read('~/secret.txt')).rejects.toThrow(BackendError)
    })

    it('should allow safe relative paths', async () => {
      for (const path of TEST_DATA.safePaths) {
        await backend.mkdir(path.split('/').slice(0, -1).join('/'), { recursive: true })
        await backend.write(path, 'content')
        const content = await backend.read(path)
        expect(content).toBe('content')
      }
    })
  })

  describe('Scoping', () => {
    it('should create scoped backend', async () => {
      const scoped = backend.scope('users/user1')

      await scoped.write('data.txt', 'user1 data')
      const content = await scoped.read('data.txt')
      expect(content).toBe('user1 data')
    })

    it('should isolate scoped backends', async () => {
      const user1 = backend.scope('users/user1')
      const user2 = backend.scope('users/user2')

      await user1.write('private.txt', 'user1 secret')
      await user2.write('private.txt', 'user2 secret')

      const user1Data = await user1.read('private.txt')
      const user2Data = await user2.read('private.txt')

      expect(user1Data).toBe('user1 secret')
      expect(user2Data).toBe('user2 secret')
    })

    it('should prevent scope escape', async () => {
      const scoped = backend.scope('users/user1')

      // Try to escape to read user2's data
      await expect(scoped.read('../user2/private.txt')).rejects.toThrow(BackendError)
    })

    it('should support nested scoping', async () => {
      const userScope = backend.scope('users/user1')
      const projectScope = userScope.scope('projects/project1')

      await projectScope.write('code.js', 'console.log("hello")')
      const content = await projectScope.read('code.js')
      expect(content).toBe('console.log("hello")')
    })
  })

  describe('Isolation Modes', () => {
    it('should support software isolation', async () => {
      const softwareBackend = createTestLocalBackend({ isolation: 'software' })

      try {
        await softwareBackend.write('test.txt', 'content')
        const content = await softwareBackend.read('test.txt')
        expect(content).toBe('content')
      } finally {
        await cleanupBackend(softwareBackend)
      }
    })

    it('should support bwrap isolation on Linux', async () => {
      // Skip if not on Linux or bwrap not available
      if (process.platform !== 'linux') {
        return
      }

      const bwrapBackend = createTestLocalBackend({ isolation: 'bwrap' })

      try {
        await bwrapBackend.write('test.txt', 'content')
        const content = await bwrapBackend.read('test.txt')
        expect(content).toBe('content')
      } finally {
        await cleanupBackend(bwrapBackend)
      }
    })
  })

  describe('Type and Connection', () => {
    it('should have correct type', () => {
      expect(backend.type).toBe('local')
    })

    it('should be connected by default', () => {
      expect(backend.connected).toBe(true)
    })

    it('should have rootDir set', () => {
      expect(backend.rootDir).toBeDefined()
      expect(typeof backend.rootDir).toBe('string')
    })
  })
})
