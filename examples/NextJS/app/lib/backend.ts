import type { FileBasedBackend } from 'agent-backend'
import { LocalFilesystemBackend, RemoteFilesystemBackend } from 'agent-backend'
import { backendConfig } from './backend-config'

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
    const config = backendConfig.getConfig()
    this.currentType = config.type

    if (config.type === 'remote' && config.remote) {
      const remote = config.remote

      if (!remote.host) {
        throw new Error('Remote backend requires host')
      }

      if (!remote.sshAuth || !remote.sshAuth.credentials.username) {
        throw new Error('Remote backend requires SSH credentials')
      }

      // RemoteFilesystemBackend will construct MCP server URL from host + mcpPort
      this.backend = new RemoteFilesystemBackend(remote)
    } else {
      const local = config.local || {
        rootDir: '/tmp/agentbe-workspace',
        isolation: 'software',
      }

      this.backend = new LocalFilesystemBackend({
        rootDir: local.rootDir,
        isolation: local.isolation || 'software',
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
