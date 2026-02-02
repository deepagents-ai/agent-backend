import type { FileBasedBackend } from 'agent-backend'
import { LocalFilesystemBackend, RemoteFilesystemBackend } from 'agent-backend'

class BackendManager {
  private backend: FileBasedBackend | null = null
  private connecting: Promise<void> | null = null
  private currentType: 'local' | 'remote' | null = null

  async getBackend(): Promise<FileBasedBackend> {
    if (this.backend) {
      return this.backend
    }

    if (this.connecting) {
      await this.connecting
      return this.backend!
    }

    this.connecting = this.initializeBackend()
    await this.connecting
    this.connecting = null

    return this.backend!
  }

  getCurrentType(): 'local' | 'remote' {
    return this.currentType || 'local'
  }

  async switchBackend(type: 'local' | 'remote'): Promise<void> {
    // Disconnect current backend
    await this.disconnect()

    // Force reinitialization with new type
    this.currentType = type
    await this.getBackend()
  }

  private async initializeBackend(): Promise<void> {
    const type = this.currentType || (process.env.NEXT_PUBLIC_BACKEND_TYPE as 'local' | 'remote') || 'local'
    this.currentType = type
    const rootDir = process.env.AGENTBE_WORKSPACE_ROOT

    if (!rootDir) {
      throw new Error('AGENTBE_WORKSPACE_ROOT environment variable is required')
    }

    if (type === 'remote') {
      const host = process.env.REMOTE_VM_HOST
      const username = process.env.REMOTE_VM_USER
      const password = process.env.REMOTE_VM_PASSWORD
      const privateKey = process.env.REMOTE_VM_PRIVATE_KEY
      const mcpServerUrl = process.env.REMOTE_MCP_URL

      if (!host || !username) {
        throw new Error('REMOTE_VM_HOST and REMOTE_VM_USER required for remote backend')
      }

      if (!password && !privateKey) {
        throw new Error('REMOTE_VM_PASSWORD or REMOTE_VM_PRIVATE_KEY required for remote backend')
      }

      if (!mcpServerUrl) {
        throw new Error('REMOTE_MCP_URL required for remote backend (e.g., http://remote-host:3001)')
      }

      this.backend = new RemoteFilesystemBackend({
        rootDir,
        host,
        sshAuth: {
          type: privateKey ? 'key' : 'password',
          credentials: {
            username,
            ...(privateKey ? { privateKey } : { password }),
          },
        },
        mcpServerUrl,
      })
    } else {
      this.backend = new LocalFilesystemBackend({
        rootDir,
        isolation: 'software',
      })
    }

    // LocalFilesystemBackend doesn't need explicit connect
    if ('connect' in this.backend && typeof this.backend.connect === 'function') {
      await this.backend.connect()
    }
  }

  async disconnect(): Promise<void> {
    if (this.backend) {
      // RemoteFilesystemBackend has destroy, LocalFilesystemBackend doesn't need cleanup
      if ('destroy' in this.backend && typeof this.backend.destroy === 'function') {
        await this.backend.destroy()
      }
      this.backend = null
    }
  }
}

export const backendManager = new BackendManager()
