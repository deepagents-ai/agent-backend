import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RemoteBackend } from '../src/backends/RemoteBackend.js'
import { ConstellationFS } from '../src/config/Config.js'
import type { RemoteBackendConfig } from '../src/backends/types.js'

/**
 * RemoteBackend unit tests
 *
 * These tests verify the RemoteBackend class behavior.
 * Since SSH2 mocking is complex and can cause hanging tests, we focus on:
 * 1. Constructor validation and configuration
 * 2. Configuration options
 *
 * Note: Tests that require actual SSH connections (execInWorkspace, file operations)
 * would need integration tests with a real SSH server or more sophisticated mocking.
 */
describe('RemoteBackend', () => {
  const baseConfig: RemoteBackendConfig = {
    type: 'remote',
    userId: 'test-remote-user',
    host: 'test-host.example.com',
    sshPort: 22,
    sshAuth: {
      type: 'password',
      credentials: {
        username: 'testuser',
        password: 'testpass',
      },
    },
    preventDangerous: true,
  }

  beforeEach(() => {
    ConstellationFS.setConfig({ workspaceRoot: '/tmp/constellation-fs-test' })
  })

  afterEach(() => {
    ConstellationFS.reset()
    vi.clearAllMocks()
  })

  describe('constructor', () => {
    it('should create backend with valid config', () => {
      const backend = new RemoteBackend(baseConfig)

      expect(backend.type).toBe('remote')
      expect(backend.userId).toBe('test-remote-user')
      expect(backend.connected).toBe(false)
    })

    it('should validate userId - reject empty', () => {
      expect(() => new RemoteBackend({
        ...baseConfig,
        userId: '',
      })).toThrow()
    })

    it('should validate userId - reject path traversal', () => {
      expect(() => new RemoteBackend({
        ...baseConfig,
        userId: '../escape',
      })).toThrow()
    })

    it('should validate userId - reject absolute paths', () => {
      expect(() => new RemoteBackend({
        ...baseConfig,
        userId: '/absolute/path',
      })).toThrow()
    })

    it('should accept key-based authentication config', () => {
      const keyConfig: RemoteBackendConfig = {
        ...baseConfig,
        sshAuth: {
          type: 'key',
          credentials: {
            username: 'testuser',
            privateKey: '-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----',
          },
        },
      }

      const backend = new RemoteBackend(keyConfig)
      expect(backend.userId).toBe('test-remote-user')
    })

    it('should accept key with passphrase', () => {
      const keyConfig: RemoteBackendConfig = {
        ...baseConfig,
        sshAuth: {
          type: 'key',
          credentials: {
            username: 'testuser',
            privateKey: '-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----',
            passphrase: 'secret',
          },
        },
      }

      const backend = new RemoteBackend(keyConfig)
      expect(backend.options.sshAuth.credentials.passphrase).toBe('secret')
    })

    it('should use default timeout values when not specified', () => {
      const backend = new RemoteBackend(baseConfig)
      expect(backend.options.operationTimeoutMs).toBeUndefined()
      expect(backend.options.keepaliveIntervalMs).toBeUndefined()
    })

    it('should accept custom timeout values', () => {
      const backend = new RemoteBackend({
        ...baseConfig,
        operationTimeoutMs: 60000,
        keepaliveIntervalMs: 15000,
        keepaliveCountMax: 5,
      })

      expect(backend.options.operationTimeoutMs).toBe(60000)
      expect(backend.options.keepaliveIntervalMs).toBe(15000)
      expect(backend.options.keepaliveCountMax).toBe(5)
    })

    it('should accept custom SSH port', () => {
      const backend = new RemoteBackend({
        ...baseConfig,
        sshPort: 2222,
      })

      expect(backend.options.sshPort).toBe(2222)
    })

    it('should accept maxOutputLength option', () => {
      const backend = new RemoteBackend({
        ...baseConfig,
        maxOutputLength: 10000,
      })

      expect(backend.options.maxOutputLength).toBe(10000)
    })

    it('should accept onDangerousOperation callback', () => {
      const callback = vi.fn()
      const backend = new RemoteBackend({
        ...baseConfig,
        onDangerousOperation: callback,
      })

      expect(backend.options.onDangerousOperation).toBe(callback)
    })
  })

  describe('destroy', () => {
    it('should handle destroy when not connected', async () => {
      const backend = new RemoteBackend(baseConfig)

      // Should not throw even when never connected
      await expect(backend.destroy()).resolves.not.toThrow()
    })

    it('should allow multiple destroy calls', async () => {
      const backend = new RemoteBackend(baseConfig)

      await backend.destroy()
      await expect(backend.destroy()).resolves.not.toThrow()
    })
  })

  describe('type property', () => {
    it('should always return "remote"', () => {
      const backend = new RemoteBackend(baseConfig)
      expect(backend.type).toBe('remote')
    })
  })

  describe('options property', () => {
    it('should expose the configuration options', () => {
      const backend = new RemoteBackend(baseConfig)

      expect(backend.options.host).toBe('test-host.example.com')
      expect(backend.options.sshPort).toBe(22)
      expect(backend.options.preventDangerous).toBe(true)
    })
  })
})
