import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { LocalFilesystemBackend } from '../../src/backends/LocalFilesystemBackend.js'
import { MemoryBackend } from '../../src/backends/MemoryBackend.js'
import { createTestLocalBackend, createTestMemoryBackend, cleanupBackend, TEST_DATA } from '../helpers/fixtures.js'
import { BackendError } from '../../src/types.js'

describe('Path Escape Prevention', () => {
  describe('LocalFilesystemBackend', () => {
    let backend: LocalFilesystemBackend

    beforeEach(() => {
      backend = createTestLocalBackend()
    })

    afterEach(async () => {
      await cleanupBackend(backend)
    })

    it('should block all escape path attempts', async () => {
      for (const escapePath of TEST_DATA.escapePaths) {
        await expect(backend.read(escapePath)).rejects.toThrow(BackendError)
        await expect(backend.write(escapePath, 'data')).rejects.toThrow(BackendError)
        await expect(backend.exists(escapePath)).rejects.toThrow(BackendError)
      }
    })

    it('should allow all safe paths', async () => {
      for (const safePath of TEST_DATA.safePaths) {
        // Create parent directories
        const dir = safePath.split('/').slice(0, -1).join('/')
        if (dir) {
          await backend.mkdir(dir, { recursive: true })
        }

        await backend.write(safePath, 'safe content')
        const content = await backend.read(safePath)
        expect(content).toBe('safe content')
        expect(await backend.exists(safePath)).toBe(true)
      }
    })

    it('should prevent escape via symlinks', async () => {
      // Create a symlink pointing outside workspace
      await backend.exec('ln -s /etc/passwd link-to-passwd').catch(() => {
        // Ignore if command fails (may be blocked)
      })

      // Attempt to read through symlink should be blocked
      await expect(backend.read('link-to-passwd')).rejects.toThrow()
    })

    it('should prevent escape in nested paths', async () => {
      await backend.mkdir('safe/nested')

      // Try to escape from nested directory
      await expect(backend.read('safe/nested/../../../../etc/passwd')).rejects.toThrow(BackendError)
    })
  })

  describe('MemoryBackend', () => {
    let backend: MemoryBackend

    beforeEach(() => {
      backend = createTestMemoryBackend()
    })

    afterEach(async () => {
      await cleanupBackend(backend)
    })

    it('should handle path-like keys without escape risks', async () => {
      // Memory backend treats keys as opaque strings, so "path escape" is different
      // But it should still validate if configured to do so

      await backend.write('users/user1/data', 'data1')
      await backend.write('users/user2/data', 'data2')

      const data1 = await backend.read('users/user1/data')
      const data2 = await backend.read('users/user2/data')

      expect(data1).toBe('data1')
      expect(data2).toBe('data2')
    })
  })

  describe('Scoped Backends', () => {
    let backend: LocalFilesystemBackend

    beforeEach(() => {
      backend = createTestLocalBackend()
    })

    afterEach(async () => {
      await cleanupBackend(backend)
    })

    it('should prevent scope escape with parent traversal', async () => {
      const user1 = backend.scope('users/user1')
      const user2 = backend.scope('users/user2')

      await user2.write('secret.txt', 'user2 secret')

      // user1 should not be able to access user2's files
      await expect(user1.read('../user2/secret.txt')).rejects.toThrow(BackendError)
    })

    it('should prevent scope escape with absolute paths', async () => {
      const scoped = backend.scope('users/user1')

      await expect(scoped.read('/etc/passwd')).rejects.toThrow(BackendError)
    })

    it('should prevent scope escape in nested scopes', async () => {
      const level1 = backend.scope('level1')
      const level2 = level1.scope('level2')
      const level3 = level2.scope('level3')

      await backend.write('root-secret.txt', 'root secret')

      // Deep nested scope should not be able to escape to root
      await expect(level3.read('../../../root-secret.txt')).rejects.toThrow(BackendError)
    })

    it('should allow access within scope boundaries', async () => {
      const scoped = backend.scope('workspace')

      await scoped.mkdir('project/src')
      await scoped.write('project/src/index.ts', 'code')
      await scoped.write('project/README.md', 'readme')

      // Should be able to navigate within scope
      const code = await scoped.read('project/src/index.ts')
      const readme = await scoped.read('project/README.md')

      expect(code).toBe('code')
      expect(readme).toBe('readme')
    })
  })
})
