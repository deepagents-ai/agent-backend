import { EventEmitter } from 'events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setTimeout as sleep } from 'timers/promises'

// Replace the SSH-WS transport with one that always fails auth
vi.mock('../../../src/backends/transports/WebSocketSSHTransport.js', async () => {
  // vi.mock is hoisted above imports, so load EventEmitter here
  const { EventEmitter } = await import('events')
  class WebSocketAuthError extends Error {
    constructor() {
      super('Daemon rejected the auth token (WebSocket closed 4001 Unauthorized). Check authToken.')
    }
  }
  const instances: InstanceType<typeof EventEmitter>[] = []
  // Whether the daemon's close event reaches the backend before or after connect() rejects
  const options = { closeAfterReject: false }
  class WebSocketSSHTransport extends EventEmitter {
    connected = false
    constructor() {
      super()
      instances.push(this)
    }
    async connect() {
      if (options.closeAfterReject) {
        setTimeout(() => this.emit('close', 4001, 'Unauthorized'), 0)
      } else {
        this.emit('close', 4001, 'Unauthorized')
      }
      throw new WebSocketAuthError()
    }
    async close() {}
  }
  return { WebSocketAuthError, WebSocketSSHTransport, instances, options }
})

import { RemoteFilesystemBackend } from '../../../src/backends/RemoteFilesystemBackend.js'
import { BackendError } from '../../../src/types.js'
import { ConnectionStatus } from '../../../src/backends/types.js'
import * as transportModule from '../../../src/backends/transports/WebSocketSSHTransport.js'

const { instances, options } = transportModule as unknown as {
  instances: EventEmitter[]
  options: { closeAfterReject: boolean }
}

describe('RemoteFilesystemBackend auth rejection (SSH-WS)', () => {
  afterEach(() => {
    instances.length = 0
    options.closeAfterReject = false
  })

  it.each([
    ['before', false],
    ['after', true],
  ])('rejects with AUTH_FAILED and never reconnects (close %s rejection)', async (_label, closeAfterReject) => {
    options.closeAfterReject = closeAfterReject
    const backend = new RemoteFilesystemBackend({
      rootDir: '/var/workspace',
      host: 'localhost',
      port: 3001,
      authToken: 'wrong',
      reconnection: { initialDelayMs: 5, maxDelayMs: 5 },
    })
    const statuses: string[] = []
    backend.onStatusChange((e) => statuses.push(e.to))

    const err = await backend.readdir('.').catch((e) => e)
    expect(err).toBeInstanceOf(BackendError)
    expect(err.code).toBe('AUTH_FAILED')
    expect(err.message).toContain('rejected the auth token')

    // Well past every (shortened) backoff delay: no further connection attempts
    await sleep(100)
    expect(instances).toHaveLength(1)
    expect(statuses).not.toContain(ConnectionStatus.RECONNECTING)
    expect(statuses[statuses.length - 1]).toBe(ConnectionStatus.DISCONNECTED)

    await backend.destroy()
  })

  it('allows a later operation to attempt a fresh connection', async () => {
    const backend = new RemoteFilesystemBackend({
      rootDir: '/var/workspace',
      host: 'localhost',
      port: 3001,
      authToken: 'wrong',
    })
    await backend.readdir('.').catch(() => {})
    await backend.readdir('.').catch(() => {})
    expect(instances).toHaveLength(2)
    await backend.destroy()
  })
})
