import { cookies } from 'next/headers'
import { COOKIE_NAME, getDefaultConfig, DEFAULT_REMOTE_CONFIG, DEFAULT_LOCAL_CONFIG, type BackendConfig } from './backend-config-types'

// Re-export types and constants for convenience
export * from './backend-config-types'

/**
 * Validate and normalize a backend config, merging with defaults for missing fields.
 * Returns null if the config is too malformed to use.
 */
function validateConfig(config: unknown): BackendConfig | null {
  if (!config || typeof config !== 'object') {
    return null
  }

  const c = config as Partial<BackendConfig>

  // Must have a valid type
  if (c.type !== 'local' && c.type !== 'remote') {
    return null
  }

  const result: BackendConfig = {
    type: c.type,
    scope: typeof c.scope === 'string' ? c.scope : undefined,
  }

  // Merge local config with defaults
  if (c.local && typeof c.local === 'object') {
    result.local = {
      rootDir: c.local.rootDir || DEFAULT_LOCAL_CONFIG.rootDir,
      isolation: c.local.isolation || DEFAULT_LOCAL_CONFIG.isolation,
    }
  } else {
    result.local = DEFAULT_LOCAL_CONFIG
  }

  // Merge remote config with defaults, ensuring sshAuth structure exists
  if (c.remote && typeof c.remote === 'object') {
    const sshAuth = c.remote.sshAuth && typeof c.remote.sshAuth === 'object'
      ? {
          type: 'password' as const,
          credentials: {
            username: c.remote.sshAuth.credentials?.username || DEFAULT_REMOTE_CONFIG.sshAuth.credentials.username,
            password: c.remote.sshAuth.credentials?.password || DEFAULT_REMOTE_CONFIG.sshAuth.credentials.password,
          },
        }
      : DEFAULT_REMOTE_CONFIG.sshAuth

    result.remote = {
      host: c.remote.host || DEFAULT_REMOTE_CONFIG.host,
      sshPort: c.remote.sshPort ?? DEFAULT_REMOTE_CONFIG.sshPort,
      mcpPort: c.remote.mcpPort ?? DEFAULT_REMOTE_CONFIG.mcpPort,
      rootDir: c.remote.rootDir || DEFAULT_REMOTE_CONFIG.rootDir,
      sshAuth,
    }
  } else {
    result.remote = DEFAULT_REMOTE_CONFIG
  }

  return result
}

/**
 * Get backend config from cookie.
 * Must be called within a request context (route handler, server component, etc.)
 */
export async function getBackendConfig(): Promise<BackendConfig> {
  try {
    const cookieStore = await cookies()
    const configCookie = cookieStore.get(COOKIE_NAME)
    if (configCookie) {
      const parsed = JSON.parse(configCookie.value)
      const validated = validateConfig(parsed)
      if (validated) {
        return validated
      }
      console.warn('[getBackendConfig] Cookie config was malformed, using defaults')
    }
  } catch (e) {
    console.warn('[getBackendConfig] Failed to read config from cookie:', e)
  }
  return getDefaultConfig()
}
