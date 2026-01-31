import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MemoryBackend } from '../../src/backends/MemoryBackend.js'
import { createTestMemoryBackend, cleanupBackend, TEST_DATA } from '../helpers/fixtures.js'
import { BackendError, NotImplementedError } from '../../src/types.js'

describe('MemoryBackend', () => {
  let backend: MemoryBackend

  beforeEach(() => {
    backend = createTestMemoryBackend()
  })

  afterEach(async () => {
    await cleanupBackend(backend)
  })

  describe('Basic Operations', () => {
    it('should write and read a value', async () => {
      await backend.write('key1', TEST_DATA.simpleFile)
      const value = await backend.read('key1')
      expect(value).toBe(TEST_DATA.simpleFile)
    })

    it('should write and read binary data', async () => {
      await backend.write('image', TEST_DATA.binaryData)
      const value = await backend.read('image', { encoding: 'buffer' })
      expect(Buffer.isBuffer(value)).toBe(true)
      expect(value).toEqual(TEST_DATA.binaryData)
    })

    it('should handle encoding conversion', async () => {
      await backend.write('text', 'Hello')

      // Read as buffer
      const asBuffer = await backend.read('text', { encoding: 'buffer' })
      expect(Buffer.isBuffer(asBuffer)).toBe(true)

      // Write buffer, read as string
      await backend.write('binary', Buffer.from('World'))
      const asString = await backend.read('binary', { encoding: 'utf8' })
      expect(asString).toBe('World')
    })

    it('should throw error for non-existent key', async () => {
      await expect(backend.read('nonexistent')).rejects.toThrow(BackendError)
      await expect(backend.read('nonexistent')).rejects.toThrow('Key not found')
    })

    it('should check if key exists', async () => {
      await backend.write('exists', 'value')

      expect(await backend.exists('exists')).toBe(true)
      expect(await backend.exists('nonexistent')).toBe(false)
    })

    it('should delete keys', async () => {
      await backend.write('temp', 'value')
      expect(await backend.exists('temp')).toBe(true)

      await backend.delete('temp')
      expect(await backend.exists('temp')).toBe(false)
    })

    it('should clear all keys', async () => {
      await backend.write('key1', 'value1')
      await backend.write('key2', 'value2')
      await backend.write('key3', 'value3')

      await backend.clear()

      expect(await backend.exists('key1')).toBe(false)
      expect(await backend.exists('key2')).toBe(false)
      expect(await backend.exists('key3')).toBe(false)
    })

    it('should touch a key', async () => {
      await backend.touch('empty')
      expect(await backend.exists('empty')).toBe(true)

      const value = await backend.read('empty')
      expect(value).toBe('')
    })
  })

  describe('Directory-like Operations', () => {
    it('should list immediate children', async () => {
      await backend.write('users/user1/data.txt', 'data1')
      await backend.write('users/user1/config.json', 'config1')
      await backend.write('users/user2/data.txt', 'data2')
      await backend.write('config/app.json', 'app-config')

      const users = await backend.readdir('users')
      expect(users).toEqual(['user1', 'user2'])

      const user1Files = await backend.readdir('users/user1')
      expect(user1Files).toContain('data.txt')
      expect(user1Files).toContain('config.json')
    })

    it('should list all keys with prefix', async () => {
      await backend.write('session/user1/state', 'state1')
      await backend.write('session/user1/cache', 'cache1')
      await backend.write('session/user2/state', 'state2')

      const allSession = await backend.list('session/')
      expect(allSession).toHaveLength(3)
      expect(allSession).toContain('session/user1/state')
      expect(allSession).toContain('session/user1/cache')
      expect(allSession).toContain('session/user2/state')
    })

    it('should list all keys when no prefix', async () => {
      await backend.write('key1', 'value1')
      await backend.write('key2', 'value2')
      await backend.write('deep/nested/key', 'value3')

      const all = await backend.list()
      expect(all.length).toBeGreaterThanOrEqual(3)
      expect(all).toContain('key1')
      expect(all).toContain('key2')
      expect(all).toContain('deep/nested/key')
    })

    it('should list scopes (top-level directories)', async () => {
      await backend.write('users/user1/data', 'data1')
      await backend.write('sessions/session1/state', 'state1')
      await backend.write('cache/item1', 'cache1')

      const scopes = await backend.listScopes()
      expect(scopes).toContain('users')
      expect(scopes).toContain('sessions')
      expect(scopes).toContain('cache')
    })

    it('should handle mkdir as no-op', async () => {
      // mkdir should succeed but do nothing (directories are implicit)
      await backend.mkdir('dir/subdir', { recursive: true })

      // Should be able to write to the "directory"
      await backend.write('dir/subdir/file.txt', 'content')
      const content = await backend.read('dir/subdir/file.txt')
      expect(content).toBe('content')
    })
  })

  describe('Stats', () => {
    it('should get stats for a key', async () => {
      const content = 'Hello, World!'
      await backend.write('test.txt', content)

      const stats = await backend.stat('test.txt')
      expect(stats.isFile()).toBe(true)
      expect(stats.isDirectory()).toBe(false)
      expect(stats.size).toBe(Buffer.byteLength(content))
    })

    it('should throw error for non-existent key stats', async () => {
      await expect(backend.stat('nonexistent')).rejects.toThrow(BackendError)
    })
  })

  describe('Initial Data', () => {
    it('should initialize with initial data', async () => {
      const backendWithData = createTestMemoryBackend({
        'config/app.json': JSON.stringify(TEST_DATA.jsonData),
        'data/state.txt': 'initial state'
      })

      try {
        const config = await backendWithData.read('config/app.json')
        expect(JSON.parse(config)).toEqual(TEST_DATA.jsonData)

        const state = await backendWithData.read('data/state.txt')
        expect(state).toBe('initial state')
      } finally {
        await cleanupBackend(backendWithData)
      }
    })
  })

  describe('Exec Not Supported', () => {
    it('should throw NotImplementedError for exec', async () => {
      await expect(backend.exec('echo "test"')).rejects.toThrow(NotImplementedError)
      await expect(backend.exec('echo "test"')).rejects.toThrow('exec')
      await expect(backend.exec('echo "test"')).rejects.toThrow('memory')
    })
  })

  describe('Scoping', () => {
    it('should create scoped backend', async () => {
      const scoped = backend.scope('session/user1')

      await scoped.write('state.json', JSON.stringify({ step: 1 }))
      const content = await scoped.read('state.json')
      expect(JSON.parse(content)).toEqual({ step: 1 })
    })

    it('should isolate scoped backends', async () => {
      const user1 = backend.scope('users/user1')
      const user2 = backend.scope('users/user2')

      await user1.write('data', 'user1 data')
      await user2.write('data', 'user2 data')

      expect(await user1.read('data')).toBe('user1 data')
      expect(await user2.read('data')).toBe('user2 data')
    })

    it('should support nested scoping', async () => {
      const sessionScope = backend.scope('sessions/abc123')
      const userScope = sessionScope.scope('user/data')

      await userScope.write('profile.json', '{"name":"Test"}')
      const content = await userScope.read('profile.json')
      expect(content).toBe('{"name":"Test"}')
    })
  })

  describe('Type and Connection', () => {
    it('should have correct type', () => {
      expect(backend.type).toBe('memory')
    })

    it('should be connected by default', () => {
      expect(backend.connected).toBe(true)
    })

    it('should have rootDir set', () => {
      expect(backend.rootDir).toBeDefined()
    })
  })
})
