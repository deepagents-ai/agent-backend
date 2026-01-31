import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { RemoteFilesystemBackend } from '../../src/backends/RemoteFilesystemBackend.js'
import { createTestRemoteBackend, cleanupBackend, TEST_DATA, isSSHServerAvailable } from '../helpers/fixtures.js'
import { BackendError, DangerousOperationError } from '../../src/types.js'

describe('RemoteFilesystemBackend', () => {
  let backend: RemoteFilesystemBackend | null

  beforeEach(async () => {
    backend = await createTestRemoteBackend()

    // Skip all tests if SSH server not available
    if (!backend) {
      console.warn('⚠️  SSH server not available at localhost:2222 - skipping RemoteFilesystemBackend tests')
      console.warn('   Start remote backend with: agentbe-server start-remote')
    }
  })

  afterEach(async () => {
    if (backend) {
      await cleanupBackend(backend)
    }
  })

  describe('Connection', () => {
    it('should connect to SSH server', async () => {
      if (!backend) return

      await backend.connect()
      expect(backend.connected).toBe(true)
    })

    it('should have correct type', () => {
      if (!backend) return

      expect(backend.type).toBe('remote')
    })
  })

  describe('Basic Operations', () => {
    it('should write and read a file', async () => {
      if (!backend) return

      await backend.write('test.txt', TEST_DATA.simpleFile)
      const content = await backend.read('test.txt')
      expect(content).toBe(TEST_DATA.simpleFile)
    })

    it('should write and read binary data', async () => {
      if (!backend) return

      await backend.write('image.png', TEST_DATA.binaryData)
      const content = await backend.read('image.png', { encoding: 'buffer' })
      expect(Buffer.isBuffer(content)).toBe(true)
      expect(content).toEqual(TEST_DATA.binaryData)
    })

    it('should create directories', async () => {
      if (!backend) return

      await backend.mkdir('subdir/nested', { recursive: true })
      await backend.write('subdir/nested/file.txt', 'content')
      const content = await backend.read('subdir/nested/file.txt')
      expect(content).toBe('content')
    })

    it('should list directory contents', async () => {
      if (!backend) return

      await backend.write('file1.txt', 'content1')
      await backend.write('file2.txt', 'content2')
      await backend.mkdir('subdir')

      const files = await backend.readdir('.')
      expect(files).toContain('file1.txt')
      expect(files).toContain('file2.txt')
      expect(files).toContain('subdir')
    })

    it('should check if file exists', async () => {
      if (!backend) return

      await backend.write('exists.txt', 'content')

      expect(await backend.exists('exists.txt')).toBe(true)
      expect(await backend.exists('nonexistent.txt')).toBe(false)
    })

    it('should get file stats', async () => {
      if (!backend) return

      const content = 'Hello, World!'
      await backend.write('test.txt', content)

      const stats = await backend.stat('test.txt')
      expect(stats.isFile()).toBe(true)
      expect(stats.size).toBeGreaterThan(0)
    })
  })

  describe('Command Execution', () => {
    it('should execute simple commands', async () => {
      if (!backend) return

      await backend.write('test.txt', 'content')
      const output = await backend.exec('ls -la')
      expect(output).toContain('test.txt')
    })

    it('should execute commands with output', async () => {
      if (!backend) return

      const output = await backend.exec('echo "Hello from remote"')
      expect(output.toString().trim()).toBe('Hello from remote')
    })

    it('should handle command errors', async () => {
      if (!backend) return

      await expect(backend.exec('nonexistent-command')).rejects.toThrow()
    })

    it('should block dangerous commands by default', async () => {
      if (!backend) return

      for (const cmd of TEST_DATA.dangerousCommands) {
        await expect(backend.exec(cmd)).rejects.toThrow(DangerousOperationError)
      }
    })
  })

  describe('Path Security', () => {
    it('should block absolute paths', async () => {
      if (!backend) return

      await expect(backend.read('/etc/passwd')).rejects.toThrow(BackendError)
    })

    it('should block parent directory traversal', async () => {
      if (!backend) return

      await expect(backend.read('../../../etc/passwd')).rejects.toThrow(BackendError)
    })

    it('should allow safe relative paths', async () => {
      if (!backend) return

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
      if (!backend) return

      const scoped = backend.scope('users/user1')

      await scoped.write('data.txt', 'user1 data')
      const content = await scoped.read('data.txt')
      expect(content).toBe('user1 data')
    })

    it('should isolate scoped backends', async () => {
      if (!backend) return

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
      if (!backend) return

      const scoped = backend.scope('users/user1')

      await expect(scoped.read('../user2/private.txt')).rejects.toThrow(BackendError)
    })
  })

  describe('SSH Connection Pooling', () => {
    it('should reuse SSH connections', async () => {
      if (!backend) return

      // Multiple operations should reuse the connection
      await backend.write('file1.txt', 'content1')
      await backend.write('file2.txt', 'content2')
      await backend.read('file1.txt')
      await backend.read('file2.txt')

      // Connection should still be active
      expect(backend.connected).toBe(true)
    })
  })
})
