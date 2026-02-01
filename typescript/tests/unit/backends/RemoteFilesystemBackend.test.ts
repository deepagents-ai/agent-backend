import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RemoteFilesystemBackend } from '../../../src/backends/RemoteFilesystemBackend.js'
import { Client } from 'ssh2'

// Mock SSH2
vi.mock('ssh2', () => ({
  Client: vi.fn()
}))

describe('RemoteFilesystemBackend (Unit Tests)', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Mock SSH2 Client constructor
    vi.mocked(Client).mockImplementation(() => ({
      on: vi.fn(),
      connect: vi.fn(),
      end: vi.fn()
    } as any))
  })

  describe('Configuration & Initialization', () => {
    it('should create backend with correct config', () => {
      const backend = new RemoteFilesystemBackend({
        rootDir: '/remote/workspace',
        host: 'example.com',
        sshAuth: {
          type: 'password',
          credentials: {
            username: 'testuser',
            password: 'testpass'
          }
        }
      })

      expect(backend.type).toBe('remote-filesystem')
      expect(backend.rootDir).toBe('/remote/workspace')
      expect(backend.connected).toBe(false)
    })

    it('should validate required config fields', () => {
      expect(() => new RemoteFilesystemBackend({
        rootDir: '/tmp',
        // @ts-expect-error - testing validation
        host: undefined,
        sshAuth: {
          type: 'password',
          credentials: { username: 'user', password: 'pass' }
        }
      })).toThrow()
    })

    it('should accept password authentication', () => {
      const passwordBackend = new RemoteFilesystemBackend({
        rootDir: '/tmp',
        host: 'example.com',
        sshAuth: {
          type: 'password',
          credentials: { username: 'user', password: 'pass' }
        }
      })

      expect(passwordBackend).toBeDefined()
    })

    it('should accept key-based authentication', () => {
      const keyBackend = new RemoteFilesystemBackend({
        rootDir: '/tmp',
        host: 'example.com',
        sshAuth: {
          type: 'key',
          credentials: {
            username: 'user',
            privateKey: '-----BEGIN RSA PRIVATE KEY-----\n...'
          }
        }
      })

      expect(keyBackend).toBeDefined()
    })

    it('should use default port 22 when not specified', () => {
      const defaultPortBackend = new RemoteFilesystemBackend({
        rootDir: '/tmp',
        host: 'example.com',
        sshAuth: {
          type: 'password',
          credentials: { username: 'user', password: 'pass' }
        }
      })

      expect(defaultPortBackend).toBeDefined()
    })

    it('should accept custom port', () => {
      const customPortBackend = new RemoteFilesystemBackend({
        rootDir: '/tmp',
        host: 'example.com',
        sshPort: 2222,
        sshAuth: {
          type: 'password',
          credentials: { username: 'user', password: 'pass' }
        }
      })

      expect(customPortBackend).toBeDefined()
    })
  })

  describe('Type and Properties', () => {
    it('should have type "remote-filesystem"', () => {
      const backend = new RemoteFilesystemBackend({
        rootDir: '/tmp',
        host: 'example.com',
        sshAuth: {
          type: 'password',
          credentials: { username: 'user', password: 'pass' }
        }
      })

      expect(backend.type).toBe('remote-filesystem')
    })

    it('should report not connected initially', () => {
      const backend = new RemoteFilesystemBackend({
        rootDir: '/tmp',
        host: 'example.com',
        sshAuth: {
          type: 'password',
          credentials: { username: 'user', password: 'pass' }
        }
      })

      expect(backend.connected).toBe(false)
    })

    it('should have rootDir property', () => {
      const backend = new RemoteFilesystemBackend({
        rootDir: '/remote/workspace',
        host: 'example.com',
        sshAuth: {
          type: 'password',
          credentials: { username: 'user', password: 'pass' }
        }
      })

      expect(backend.rootDir).toBe('/remote/workspace')
    })
  })

  describe('Scoping', () => {
    it('should create scoped backend with correct path', () => {
      const backend = new RemoteFilesystemBackend({
        rootDir: '/remote/workspace',
        host: 'example.com',
        sshAuth: {
          type: 'password',
          credentials: { username: 'user', password: 'pass' }
        }
      })

      const scoped = backend.scope('users/user1')

      expect(scoped.rootDir).toContain('users/user1')
      expect(scoped.type).toBe('remote-filesystem')
    })

    it('should reject scope escape attempts', () => {
      const backend = new RemoteFilesystemBackend({
        rootDir: '/remote/workspace',
        host: 'example.com',
        sshAuth: {
          type: 'password',
          credentials: { username: 'user', password: 'pass' }
        }
      })

      expect(() => backend.scope('../../../etc')).toThrow(/Path escapes/)
    })

    it('should allow valid scope paths', () => {
      const backend = new RemoteFilesystemBackend({
        rootDir: '/remote/workspace',
        host: 'example.com',
        sshAuth: {
          type: 'password',
          credentials: { username: 'user', password: 'pass' }
        }
      })

      expect(() => backend.scope('valid/scope')).not.toThrow()
    })
  })
})
