/**
 * WebSocket SSH Transport
 *
 * Client-side transport that connects to an SSH-over-WebSocket server.
 * Used by RemoteFilesystemBackend as the default transport (replacing direct sshd).
 *
 * Benefits:
 * - Single port connection (same port as MCP HTTP)
 * - Works through HTTP proxies and load balancers
 * - Unified authentication (same token as MCP)
 */

import { EventEmitter } from 'events'
import type { ClientChannel, SFTPWrapper } from 'ssh2'
import { Duplex } from 'stream'
import WebSocket from 'ws'
import { SSH2Client as SSHClient, type SSH2ClientType } from '../../utils/ssh2.js'
import { daemonScheme, mergeDaemonHeaders } from './daemonEndpoint.js'

export interface WebSocketSSHTransportConfig {
  /** Remote host */
  host: string
  /** Port for WebSocket connection (same as MCP port) */
  port: number
  /** WebSocket path (default: /ssh) */
  path?: string
  /** Bearer token, sent as an Authorization header on the upgrade request */
  authToken?: string
  /** Use wss:// (default: true when port is 443) */
  secure?: boolean
  /** Extra headers for the upgrade request. Cannot override Authorization. */
  headers?: Record<string, string>
  /** Connection timeout in ms (default: 30000) */
  timeout?: number
  /** Keep-alive interval in ms (default: 30000) */
  keepaliveInterval?: number
}

/** WebSocket close code the daemon uses when it rejects the auth token */
export const WS_CLOSE_UNAUTHORIZED = 4001

/** Max time to wait for the WebSocket close code after a failed SSH handshake */
const CLOSE_CODE_WAIT_MS = 500

/** Thrown when the daemon rejects the connection's auth token */
export class WebSocketAuthError extends Error {
  constructor() {
    super('Daemon rejected the auth token (WebSocket closed 4001 Unauthorized). Check authToken.')
    this.name = 'WebSocketAuthError'
  }
}

export interface ExecResult {
  stdout: string
  stderr: string
  code: number
}

/**
 * SSH transport over WebSocket
 *
 * Establishes an SSH connection over a WebSocket, allowing SSH operations
 * (exec, SFTP) through a single HTTP port.
 */
export class WebSocketSSHTransport extends EventEmitter {
  private ws: WebSocket | null = null
  private sshClient: SSH2ClientType | null = null
  private sftpSession: SFTPWrapper | null = null
  private sftpSessionPromise: Promise<SFTPWrapper> | null = null
  private _connected = false
  private readonly config: Required<Omit<WebSocketSSHTransportConfig, 'authToken' | 'secure' | 'headers'>> &
    Pick<WebSocketSSHTransportConfig, 'authToken' | 'secure' | 'headers'>

  constructor(config: WebSocketSSHTransportConfig) {
    super()
    this.config = {
      path: '/ssh',
      timeout: 30000,
      keepaliveInterval: 30000,
      ...config
    }
  }

  get connected(): boolean {
    return this._connected
  }

  /**
   * Connect to the SSH-over-WebSocket server
   */
  async connect(): Promise<void> {
    if (this._connected) return

    return new Promise((resolve, reject) => {
      const protocol = daemonScheme('ws', this.config.port, this.config.secure)
      const url = `${protocol}://${this.config.host}:${this.config.port}${this.config.path}`

      // Token goes in a header, never the URL: proxies and access logs record query strings
      const ownHeaders: Record<string, string> = {}
      if (this.config.authToken) {
        ownHeaders['Authorization'] = `Bearer ${this.config.authToken}`
      }
      const headers = mergeDaemonHeaders(this.config.headers, ownHeaders)

      let settled = false
      const fail = (err: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timeoutId)
        this.cleanup()
        reject(err)
      }

      // Connection timeout
      const timeoutId = setTimeout(() => {
        fail(new Error(`Connection timeout after ${this.config.timeout}ms`))
      }, this.config.timeout)

      const ws = new WebSocket(url, { headers })
      this.ws = ws
      const closeCode = new Promise<number>((res) => ws.once('close', (code) => res(code)))

      ws.on('open', () => {
        // WebSocket connected, now establish SSH session
        this.establishSSH()
          .then(() => {
            if (settled) return
            settled = true
            clearTimeout(timeoutId)
            this._connected = true
            this.emit('connect')
            resolve()
          })
          .catch(async (err: Error) => {
            // An auth rejection closes the socket mid-handshake, so the SSH layer
            // reports a generic write error first. Prefer the close code if one arrives.
            if (ws.readyState !== WebSocket.OPEN) {
              const code = await Promise.race([
                closeCode,
                new Promise<undefined>((res) => setTimeout(() => res(undefined), CLOSE_CODE_WAIT_MS)),
              ])
              if (code === WS_CLOSE_UNAUTHORIZED) {
                fail(new WebSocketAuthError())
                return
              }
            }
            fail(err)
          })
      })

      ws.on('error', (err) => {
        // e.g. "Unexpected server response: 404" from a proxy; name the endpoint
        fail(new Error(`WebSocket connection to ${url} failed: ${err.message}`, { cause: err }))
      })

      ws.on('close', (code, reason) => {
        this._connected = false
        fail(code === WS_CLOSE_UNAUTHORIZED
          ? new WebSocketAuthError()
          : new Error(`WebSocket closed before the SSH session was established (code ${code})`))
        this.cleanup()
        this.emit('close', code, reason.toString())
      })
    })
  }

  /**
   * Establish SSH session over the WebSocket
   */
  private async establishSSH(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.ws) {
        reject(new Error('WebSocket not connected'))
        return
      }

      const stream = this.createStreamFromWebSocket(this.ws)
      this.sshClient = new SSHClient()

      this.sshClient.on('ready', () => {
        resolve()
      })

      this.sshClient.on('error', (err: Error) => {
        reject(err)
      })

      this.sshClient.on('close', () => {
        this._connected = false
        this.emit('close')
      })

      // Connect SSH client over WebSocket stream
      // Auth is via WebSocket token, so we use dummy credentials
      this.sshClient.connect({
        sock: stream,
        username: 'agent',
        password: 'agent',
        readyTimeout: this.config.timeout,
        keepaliveInterval: this.config.keepaliveInterval,
        keepaliveCountMax: 3
      })
    })
  }

  /**
   * Create a Duplex stream from a WebSocket
   */
  private createStreamFromWebSocket(ws: WebSocket): Duplex {
    let destroyed = false

    const stream = new Duplex({
      read() {
        // Data is pushed via ws.on('message')
      },
      write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
        if (destroyed || ws.readyState !== WebSocket.OPEN) {
          callback(new Error('WebSocket is not open'))
          return
        }

        ws.send(chunk, (err) => {
          callback(err)
        })
      },
      final(callback: (error?: Error | null) => void) {
        callback()
      },
      destroy(err: Error | null, callback: (error?: Error | null) => void) {
        destroyed = true
        callback(err)
      }
    })

    ws.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
      if (destroyed) return

      let buffer: Buffer
      if (Buffer.isBuffer(data)) {
        buffer = data
      } else if (data instanceof ArrayBuffer) {
        buffer = Buffer.from(data)
      } else {
        buffer = Buffer.concat(data)
      }

      stream.push(buffer)
    })

    ws.on('close', () => {
      if (!destroyed) {
        stream.push(null)
      }
    })

    ws.on('error', (err) => {
      if (!destroyed) {
        stream.destroy(err)
      }
    })

    return stream
  }

  /**
   * Execute a command over SSH
   */
  async exec(command: string, options?: { timeout?: number }): Promise<ExecResult> {
    if (!this._connected || !this.sshClient) {
      throw new Error('Not connected')
    }

    return new Promise((resolve, reject) => {
      const timeout = options?.timeout ?? 120000

      const timeoutId = setTimeout(() => {
        reject(new Error(`Command timed out after ${timeout}ms`))
      }, timeout)

      this.sshClient!.exec(command, (err: Error | undefined, channel: ClientChannel) => {
        if (err) {
          clearTimeout(timeoutId)
          reject(err)
          return
        }

        let stdout = ''
        let stderr = ''

        channel.on('data', (data: Buffer) => {
          stdout += data.toString()
        })

        channel.stderr.on('data', (data: Buffer) => {
          stderr += data.toString()
        })

        channel.on('close', (code: number) => {
          clearTimeout(timeoutId)
          resolve({ stdout, stderr, code: code ?? 0 })
        })

        channel.on('error', (channelErr: Error) => {
          clearTimeout(timeoutId)
          reject(channelErr)
        })
      })
    })
  }

  /**
   * Execute a command and stream output via callback
   */
  async execStream(
    command: string,
    onStdout: (data: Buffer) => void,
    onStderr: (data: Buffer) => void
  ): Promise<number> {
    if (!this._connected || !this.sshClient) {
      throw new Error('Not connected')
    }

    return new Promise((resolve, reject) => {
      this.sshClient!.exec(command, (err: Error | undefined, channel: ClientChannel) => {
        if (err) {
          reject(err)
          return
        }

        channel.on('data', (data: Buffer) => {
          onStdout(data)
        })

        channel.stderr.on('data', (data: Buffer) => {
          onStderr(data)
        })

        channel.on('close', (code: number) => {
          resolve(code ?? 0)
        })

        channel.on('error', reject)
      })
    })
  }

  /**
   * Get or create SFTP session
   */
  async getSFTP(): Promise<SFTPWrapper> {
    if (this.sftpSession) {
      return this.sftpSession
    }

    if (this.sftpSessionPromise) {
      return this.sftpSessionPromise
    }

    if (!this._connected || !this.sshClient) {
      throw new Error('Not connected')
    }

    this.sftpSessionPromise = new Promise((resolve, reject) => {
      this.sshClient!.sftp((err: Error | undefined, sftp: SFTPWrapper) => {
        if (err) {
          this.sftpSessionPromise = null
          reject(err)
          return
        }

        this.sftpSession = sftp
        this.sftpSessionPromise = null

        // Handle SFTP session close
        sftp.on('close', () => {
          this.sftpSession = null
        })

        resolve(sftp)
      })
    })

    return this.sftpSessionPromise
  }

  /**
   * Disconnect from the server
   */
  async disconnect(): Promise<void> {
    this.cleanup()
  }

  /**
   * Clean up all resources
   */
  private cleanup(): void {
    this._connected = false

    if (this.sftpSession) {
      try {
        this.sftpSession.end()
      } catch {
        // Ignore errors during cleanup
      }
      this.sftpSession = null
      this.sftpSessionPromise = null
    }

    if (this.sshClient) {
      try {
        this.sshClient.end()
      } catch {
        // Ignore errors during cleanup
      }
      this.sshClient = null
    }

    if (this.ws) {
      try {
        this.ws.close()
      } catch {
        // Ignore errors during cleanup
      }
      this.ws = null
    }
  }
}
