import { getLogger } from '../utils/logger'

/**
 * Library-level configuration interface for AgentBackend
 */
export interface LibraryConfig {
  /** Base mount directory for all AgentBackend workspaces. Defaults to /agent-backend */
  workspaceRoot?: string
}

/**
 * Static configuration manager for AgentBackend library.
 *
 * @example
 * ```typescript
 * // Set config at app startup
 * AgentBackend.setConfig({ workspaceRoot: '/customWorkspaceRoot' })
 *
 * // Access config anywhere
 * const config = AgentBackend.getConfig()
 * const workspaceRoot = AgentBackend.getWorkspaceRoot()
 * ```
 */
export class AgentBackend {
  private static config: LibraryConfig | null = null

  private constructor() {
    // Prevent instantiation
  }

  /**
   * Set configuration programmatically. Must be called before using AgentBackend.
   * @param config Configuration to apply
   */
  static setConfig(config: Partial<LibraryConfig>): void {
    AgentBackend.config = {
      workspaceRoot: config.workspaceRoot || '/agent-backend',
    }
    getLogger().info('AgentBackend configuration set:', AgentBackend.config)
  }

  /**
   * Get the full configuration object.
   * @throws {Error} If setConfig() has not been called
   */
  static getConfig(): Readonly<LibraryConfig> {
    if (!AgentBackend.config) {
      throw new Error('AgentBackend.setConfig() must be called before use')
    }
    return { ...AgentBackend.config }
  }

  /**
   * Get the workspace root directory.
   * @throws {Error} If setConfig() has not been called
   */
  static getWorkspaceRoot(): string {
    if (!AgentBackend.config) {
      throw new Error('AgentBackend.setConfig() must be called before use')
    }
    return AgentBackend.config.workspaceRoot!
  }

  /**
   * Reset configuration (useful for testing)
   */
  static reset(): void {
    AgentBackend.config = null
  }
}
