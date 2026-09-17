import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'

// Mock ws module
vi.mock('ws', () => {
  const MockWebSocket = vi.fn()
  MockWebSocket.OPEN = 1
  MockWebSocket.CLOSED = 3
  return { default: MockWebSocket, WebSocket: MockWebSocket }
})

// Mock our SSH2 wrapper
vi.mock('../../../src/utils/ssh2.js', () => ({
  SSH2Client: vi.fn()
}))

import { WebSocketAuthError, WebSocketSSHTransport } from '../../../src/backends/transports/WebSocketSSHTransport.js'
import WebSocket from 'ws'
import { SSH2Client as SSHClient } from '../../../src/utils/ssh2.js'

// Helper to create a mock WebSocket with configurable behavior
function createMockWebSocket(options: {
  openBehavior?: 'success' | 'error' | 'timeout'
  readyState?: number
} = {}) {
  const ws = new EventEmitter() as EventEmitter & {
    send: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
    readyState: number
  }
  ws.send = vi.fn((data, callback) => callback?.())
  ws.close = vi.fn()
  ws.readyState = options.readyState ?? 1 // OPEN

  // Trigger open or error based on behavior
  if (options.openBehavior === 'error') {
    setTimeout(() => ws.emit('error', new Error('Connection refused')), 0)
  } else if (options.openBehavior !== 'timeout') {
    setTimeout(() => ws.emit('open'), 0)
  }

  return ws
}

// Helper to create a mock SSH client
function createMockSSHClient(options: {
  connectBehavior?: 'success' | 'error'
  execResults?: { stdout: string; stderr?: string; code: number }
} = {}) {
  const client = new EventEmitter() as EventEmitter & {
    connect: ReturnType<typeof vi.fn>
    exec: ReturnType<typeof vi.fn>
    sftp: ReturnType<typeof vi.fn>
    end: ReturnType<typeof vi.fn>
  }

  client.connect = vi.fn(() => {
    if (options.connectBehavior === 'error') {
      setTimeout(() => client.emit('error', new Error('SSH handshake failed')), 0)
    } else {
      setTimeout(() => client.emit('ready'), 0)
    }
  })

  client.exec = vi.fn((command: string, callback: Function) => {
    const channel = new EventEmitter() as EventEmitter & { stderr: EventEmitter }
    channel.stderr = new EventEmitter()
    const result = options.execResults ?? { stdout: '', stderr: '', code: 0 }

    setTimeout(() => {
      if (result.stdout) channel.emit('data', Buffer.from(result.stdout))
      if (result.stderr) channel.stderr.emit('data', Buffer.from(result.stderr))
      channel.emit('close', result.code)
    }, 0)

    callback(null, channel)
  })

  client.sftp = vi.fn((callback) => {
    const sftp = new EventEmitter()
    callback(null, sftp)
  })

  client.end = vi.fn()

  return client
}

describe('WebSocketSSHTransport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Configuration', () => {
    it('should initialize with config and report disconnected', () => {
      const transport = new WebSocketSSHTransport({
        host: 'remote.example.com',
        port: 3001,
        authToken: 'secret-token'
      })

      expect(transport.connected).toBe(false)
    })

    it('should use default path and timeout values', () => {
      const mockWs = createMockWebSocket()
      vi.mocked(WebSocket).mockImplementation(function () { return mockWs as any })

      const mockSsh = createMockSSHClient()
      vi.mocked(SSHClient).mockImplementation(function () { return mockSsh as any })

      const transport = new WebSocketSSHTransport({
        host: 'example.com',
        port: 3001
      })

      // Trigger connection to verify URL construction
      transport.connect().catch(() => {})

      // Should use default /ssh path
      expect(WebSocket).toHaveBeenCalledWith(expect.stringContaining('/ssh'), expect.anything())
    })
  })

  describe('Connection', () => {
    it('should connect via WebSocket then establish SSH session', async () => {
      const mockWs = createMockWebSocket()
      vi.mocked(WebSocket).mockImplementation(function () { return mockWs as any })

      const mockSsh = createMockSSHClient()
      vi.mocked(SSHClient).mockImplementation(function () { return mockSsh as any })

      const transport = new WebSocketSSHTransport({
        host: 'example.com',
        port: 3001,
        authToken: 'test-token'
      })

      await transport.connect()

      expect(transport.connected).toBe(true)
      expect(WebSocket).toHaveBeenCalledWith(
        'ws://example.com:3001/ssh',
        { headers: { Authorization: 'Bearer test-token' } }
      )
      expect(mockSsh.connect).toHaveBeenCalled()
    })

    it('should not reconnect if already connected', async () => {
      const mockWs = createMockWebSocket()
      vi.mocked(WebSocket).mockImplementation(function () { return mockWs as any })

      const mockSsh = createMockSSHClient()
      vi.mocked(SSHClient).mockImplementation(function () { return mockSsh as any })

      const transport = new WebSocketSSHTransport({
        host: 'example.com',
        port: 3001
      })

      await transport.connect()
      await transport.connect() // Second call should be no-op

      expect(WebSocket).toHaveBeenCalledTimes(1)
    })

    it('should handle WebSocket connection errors', async () => {
      const mockWs = createMockWebSocket({ openBehavior: 'error' })
      vi.mocked(WebSocket).mockImplementation(function () { return mockWs as any })

      const transport = new WebSocketSSHTransport({
        host: 'example.com',
        port: 3001
      })

      await expect(transport.connect()).rejects.toThrow(
        'WebSocket connection to ws://example.com:3001/ssh failed: Connection refused'
      )
      expect(transport.connected).toBe(false)
    })

    it('should handle SSH handshake errors', async () => {
      const mockWs = createMockWebSocket()
      vi.mocked(WebSocket).mockImplementation(function () { return mockWs as any })

      const mockSsh = createMockSSHClient({ connectBehavior: 'error' })
      vi.mocked(SSHClient).mockImplementation(function () { return mockSsh as any })

      const transport = new WebSocketSSHTransport({
        host: 'example.com',
        port: 3001
      })

      await expect(transport.connect()).rejects.toThrow('SSH handshake failed')
    })

    it('should use wss:// for port 443', async () => {
      const mockWs = createMockWebSocket()
      vi.mocked(WebSocket).mockImplementation(function () { return mockWs as any })

      const mockSsh = createMockSSHClient()
      vi.mocked(SSHClient).mockImplementation(function () { return mockSsh as any })

      const transport = new WebSocketSSHTransport({
        host: 'example.com',
        port: 443
      })

      await transport.connect()

      expect(WebSocket).toHaveBeenCalledWith(expect.stringContaining('wss://'), expect.anything())
    })
  })

  describe('TLS and headers', () => {
    function connectWith(config: Partial<ConstructorParameters<typeof WebSocketSSHTransport>[0]>) {
      vi.mocked(WebSocket).mockImplementation(function () { return createMockWebSocket() as any })
      vi.mocked(SSHClient).mockImplementation(function () { return createMockSSHClient() as any })
      const transport = new WebSocketSSHTransport({ host: 'example.com', port: 3001, ...config })
      return transport.connect().then(() => vi.mocked(WebSocket).mock.calls[0] as unknown as [string, { headers: Record<string, string> }])
    }

    it.each([
      [true, 3001, 'wss://example.com:3001/ssh'],
      [true, 443, 'wss://example.com:443/ssh'],
      [false, 3001, 'ws://example.com:3001/ssh'],
      [false, 443, 'ws://example.com:443/ssh'],
      [undefined, 3001, 'ws://example.com:3001/ssh'],
      [undefined, 443, 'wss://example.com:443/ssh'],
    ])('secure=%s port=%s connects to %s', async (secure, port, expected) => {
      const [url] = await connectWith({ secure, port })
      expect(url).toBe(expected)
    })

    it('never puts the token in the URL', async () => {
      const [url, opts] = await connectWith({ authToken: 's3cret' })
      expect(url).not.toContain('token')
      expect(url).not.toContain('s3cret')
      expect(opts.headers.Authorization).toBe('Bearer s3cret')
    })

    it('sends extra headers on the upgrade request', async () => {
      const [, opts] = await connectWith({ authToken: 'tok', headers: { 'fly-force-instance-id': 'm1' } })
      expect(opts.headers).toEqual({ 'fly-force-instance-id': 'm1', Authorization: 'Bearer tok' })
    })

    it('does not let extra headers override Authorization', async () => {
      const [, opts] = await connectWith({
        authToken: 'tok',
        headers: { authorization: 'Bearer evil', AUTHORIZATION: 'x' },
      })
      expect(opts.headers).toEqual({ Authorization: 'Bearer tok' })
    })

    it('does not send a caller Authorization header even without a token', async () => {
      const [, opts] = await connectWith({ headers: { Authorization: 'Bearer evil', 'x-route': 'a' } })
      expect(opts.headers).toEqual({ 'x-route': 'a' })
    })
  })

  describe('Authentication rejection', () => {
    function rejectingSSHClient(ws: EventEmitter & { readyState: number }, closeCode: number, closeFirst: boolean) {
      const client = createMockSSHClient()
      client.connect = vi.fn(() => {
        // Daemon closes the socket; SSH layer then fails with a generic write error
        setTimeout(() => {
          ws.readyState = 3
          if (closeFirst) ws.emit('close', closeCode, Buffer.from('Unauthorized'))
          client.emit('error', new Error('WebSocket is not open'))
          if (!closeFirst) setTimeout(() => ws.emit('close', closeCode, Buffer.from('Unauthorized')), 10)
        }, 0)
      })
      return client
    }

    it.each([
      ['before', true],
      ['after', false],
    ])('rejects with WebSocketAuthError when 4001 arrives %s the SSH error', async (_label, closeFirst) => {
      const mockWs = createMockWebSocket()
      vi.mocked(WebSocket).mockImplementation(function () { return mockWs as any })
      vi.mocked(SSHClient).mockImplementation(function () { return rejectingSSHClient(mockWs, 4001, closeFirst) as any })

      const transport = new WebSocketSSHTransport({ host: 'example.com', port: 3001, authToken: 'wrong' })

      const err = await transport.connect().catch((e) => e)
      expect(err).toBeInstanceOf(WebSocketAuthError)
      expect(err.message).toContain('rejected the auth token')
      expect(transport.connected).toBe(false)
    })

    it('keeps the original error for other close codes', async () => {
      const mockWs = createMockWebSocket()
      vi.mocked(WebSocket).mockImplementation(function () { return mockWs as any })
      vi.mocked(SSHClient).mockImplementation(function () { return rejectingSSHClient(mockWs, 1006, false) as any })

      const transport = new WebSocketSSHTransport({ host: 'example.com', port: 3001 })

      const err = await transport.connect().catch((e) => e)
      expect(err).not.toBeInstanceOf(WebSocketAuthError)
      expect(err.message).not.toContain('auth token')
    })
  })

  describe('Command Execution', () => {
    it('should execute command and return stdout/stderr/code', async () => {
      const mockWs = createMockWebSocket()
      vi.mocked(WebSocket).mockImplementation(function () { return mockWs as any })

      const mockSsh = createMockSSHClient({
        execResults: { stdout: 'hello world\n', stderr: '', code: 0 }
      })
      vi.mocked(SSHClient).mockImplementation(function () { return mockSsh as any })

      const transport = new WebSocketSSHTransport({
        host: 'example.com',
        port: 3001
      })

      await transport.connect()
      const result = await transport.exec('echo hello world')

      expect(result.stdout).toBe('hello world\n')
      expect(result.code).toBe(0)
    })

    it('should capture stderr and non-zero exit codes', async () => {
      const mockWs = createMockWebSocket()
      vi.mocked(WebSocket).mockImplementation(function () { return mockWs as any })

      const mockSsh = createMockSSHClient({
        execResults: { stdout: '', stderr: 'error message', code: 1 }
      })
      vi.mocked(SSHClient).mockImplementation(function () { return mockSsh as any })

      const transport = new WebSocketSSHTransport({
        host: 'example.com',
        port: 3001
      })

      await transport.connect()
      const result = await transport.exec('false')

      expect(result.stderr).toBe('error message')
      expect(result.code).toBe(1)
    })

    it('should throw when executing without connection', async () => {
      const transport = new WebSocketSSHTransport({
        host: 'example.com',
        port: 3001
      })

      await expect(transport.exec('echo test')).rejects.toThrow('Not connected')
    })
  })

  describe('SFTP', () => {
    it('should get SFTP session', async () => {
      const mockWs = createMockWebSocket()
      vi.mocked(WebSocket).mockImplementation(function () { return mockWs as any })

      const mockSsh = createMockSSHClient()
      vi.mocked(SSHClient).mockImplementation(function () { return mockSsh as any })

      const transport = new WebSocketSSHTransport({
        host: 'example.com',
        port: 3001
      })

      await transport.connect()
      const sftp = await transport.getSFTP()

      expect(sftp).toBeDefined()
      expect(mockSsh.sftp).toHaveBeenCalled()
    })

    it('should reuse existing SFTP session', async () => {
      const mockWs = createMockWebSocket()
      vi.mocked(WebSocket).mockImplementation(function () { return mockWs as any })

      const mockSsh = createMockSSHClient()
      vi.mocked(SSHClient).mockImplementation(function () { return mockSsh as any })

      const transport = new WebSocketSSHTransport({
        host: 'example.com',
        port: 3001
      })

      await transport.connect()
      await transport.getSFTP()
      await transport.getSFTP()

      expect(mockSsh.sftp).toHaveBeenCalledTimes(1)
    })
  })

  describe('Disconnect', () => {
    it('should clean up resources on disconnect', async () => {
      const mockWs = createMockWebSocket()
      vi.mocked(WebSocket).mockImplementation(function () { return mockWs as any })

      const mockSsh = createMockSSHClient()
      vi.mocked(SSHClient).mockImplementation(function () { return mockSsh as any })

      const transport = new WebSocketSSHTransport({
        host: 'example.com',
        port: 3001
      })

      await transport.connect()
      expect(transport.connected).toBe(true)

      await transport.disconnect()
      expect(transport.connected).toBe(false)
      expect(mockSsh.end).toHaveBeenCalled()
      expect(mockWs.close).toHaveBeenCalled()
    })
  })
})
