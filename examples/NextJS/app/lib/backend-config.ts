import type { LocalFilesystemBackendConfig, RemoteFilesystemBackendConfig } from 'agent-backend'

export type BackendConfig = {
  type: 'local' | 'remote'
  local?: LocalFilesystemBackendConfig
  remote?: RemoteFilesystemBackendConfig
}

class BackendConfigManager {
  private config: BackendConfig = {
    type: 'local',
    local: {
      rootDir: '/tmp/agentbe-workspace',
      isolation: 'software',
    },
  }

  getConfig(): BackendConfig {
    return this.config
  }

  setConfig(config: BackendConfig): void {
    this.config = config
  }

  reset(): void {
    this.config = {
      type: 'local',
      local: {
        rootDir: '/tmp/agentbe-workspace',
        isolation: 'software',
      },
    }
  }
}

export const backendConfig = new BackendConfigManager()
