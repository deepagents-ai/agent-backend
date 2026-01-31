import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { BackendPoolManager } from '../../src/pooling/BackendPoolManager.js'
import { LocalFilesystemBackend } from '../../src/backends/LocalFilesystemBackend.js'
import { MemoryBackend } from '../../src/backends/MemoryBackend.js'
import { getTempDir } from '../helpers/fixtures.js'

describe('BackendPoolManager', () => {
  describe('LocalFilesystemBackend Pooling', () => {
    let pool: BackendPoolManager<LocalFilesystemBackend>

    beforeEach(() => {
      pool = new BackendPoolManager({
        backendClass: LocalFilesystemBackend,
        defaultConfig: {
          rootDir: getTempDir('pool-test'),
          isolation: 'software',
          preventDangerous: true
        }
      })
    })

    afterEach(async () => {
      await pool.destroyAll()
    })

    it('should create and reuse backends', async () => {
      let backend1Ref: LocalFilesystemBackend | null = null
      let backend2Ref: LocalFilesystemBackend | null = null

      await pool.withBackend({ key: 'user1' }, async (backend) => {
        backend1Ref = backend
        await backend.write('test.txt', 'data1')
      })

      await pool.withBackend({ key: 'user1' }, async (backend) => {
        backend2Ref = backend
        // Should reuse the same backend instance
        const content = await backend.read('test.txt')
        expect(content).toBe('data1')
      })

      // Should be the same backend instance
      expect(backend1Ref).toBe(backend2Ref)
    })

    it('should isolate different keys', async () => {
      await pool.withBackend({ key: 'user1' }, async (backend) => {
        await backend.write('data.txt', 'user1 data')
      })

      await pool.withBackend({ key: 'user2' }, async (backend) => {
        await backend.write('data.txt', 'user2 data')
      })

      // Verify isolation
      await pool.withBackend({ key: 'user1' }, async (backend) => {
        const content = await backend.read('data.txt')
        expect(content).toBe('user1 data')
      })

      await pool.withBackend({ key: 'user2' }, async (backend) => {
        const content = await backend.read('data.txt')
        expect(content).toBe('user2 data')
      })
    })

    it('should handle async operations', async () => {
      const result = await pool.withBackend({ key: 'async-test' }, async (backend) => {
        await backend.write('test.txt', 'async data')
        const content = await backend.read('test.txt')
        return content.toUpperCase()
      })

      expect(result).toBe('ASYNC DATA')
    })

    it('should handle errors and cleanup', async () => {
      await expect(
        pool.withBackend({ key: 'error-test' }, async (backend) => {
          await backend.write('test.txt', 'data')
          throw new Error('Test error')
        })
      ).rejects.toThrow('Test error')

      // Backend should still be usable after error
      await pool.withBackend({ key: 'error-test' }, async (backend) => {
        const content = await backend.read('test.txt')
        expect(content).toBe('data')
      })
    })

    it('should support per-request config overrides', async () => {
      await pool.withBackend(
        {
          key: 'override-test',
          config: { preventDangerous: false }
        },
        async (backend) => {
          // This backend should have preventDangerous: false
          await backend.write('test.txt', 'data')
          const content = await backend.read('test.txt')
          expect(content).toBe('data')
        }
      )
    })

    it('should destroy all backends', async () => {
      await pool.withBackend({ key: 'user1' }, async (backend) => {
        await backend.write('test.txt', 'data')
      })

      await pool.withBackend({ key: 'user2' }, async (backend) => {
        await backend.write('test.txt', 'data')
      })

      await pool.destroyAll()

      // After destroy, should create new backends
      await pool.withBackend({ key: 'user1' }, async (backend) => {
        // File should not exist (new backend)
        await expect(backend.read('test.txt')).rejects.toThrow()
      })
    })
  })

  describe('MemoryBackend Pooling', () => {
    let pool: BackendPoolManager<MemoryBackend>

    beforeEach(() => {
      pool = new BackendPoolManager({
        backendClass: MemoryBackend,
        defaultConfig: {
          rootDir: '/pool-memory'
        }
      })
    })

    afterEach(async () => {
      await pool.destroyAll()
    })

    it('should pool memory backends', async () => {
      await pool.withBackend({ key: 'session1' }, async (backend) => {
        await backend.write('state', JSON.stringify({ step: 1 }))
      })

      await pool.withBackend({ key: 'session1' }, async (backend) => {
        const state = await backend.read('state')
        expect(JSON.parse(state)).toEqual({ step: 1 })
      })
    })

    it('should isolate memory backend keys', async () => {
      await pool.withBackend({ key: 'session1' }, async (backend) => {
        await backend.write('data', 'session1')
      })

      await pool.withBackend({ key: 'session2' }, async (backend) => {
        await backend.write('data', 'session2')
      })

      await pool.withBackend({ key: 'session1' }, async (backend) => {
        expect(await backend.read('data')).toBe('session1')
      })

      await pool.withBackend({ key: 'session2' }, async (backend) => {
        expect(await backend.read('data')).toBe('session2')
      })
    })
  })

  describe('Concurrent Access', () => {
    let pool: BackendPoolManager<MemoryBackend>

    beforeEach(() => {
      pool = new BackendPoolManager({
        backendClass: MemoryBackend,
        defaultConfig: { rootDir: '/concurrent' }
      })
    })

    afterEach(async () => {
      await pool.destroyAll()
    })

    it('should handle concurrent requests to same key', async () => {
      const promises = Array.from({ length: 10 }, (_, i) =>
        pool.withBackend({ key: 'shared' }, async (backend) => {
          await backend.write(`file${i}`, `data${i}`)
          return await backend.read(`file${i}`)
        })
      )

      const results = await Promise.all(promises)

      results.forEach((result, i) => {
        expect(result).toBe(`data${i}`)
      })
    })

    it('should handle concurrent requests to different keys', async () => {
      const promises = Array.from({ length: 10 }, (_, i) =>
        pool.withBackend({ key: `user${i}` }, async (backend) => {
          await backend.write('data', `user${i} data`)
          return await backend.read('data')
        })
      )

      const results = await Promise.all(promises)

      results.forEach((result, i) => {
        expect(result).toBe(`user${i} data`)
      })
    })
  })
})
