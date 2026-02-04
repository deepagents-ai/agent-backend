import { cookies } from 'next/headers'
import { COOKIE_NAME, getDefaultConfig, type BackendConfig } from './backend-config-types'

// Re-export types and constants for convenience
export * from './backend-config-types'

/**
 * Get backend config from cookie.
 * Must be called within a request context (route handler, server component, etc.)
 */
export async function getBackendConfig(): Promise<BackendConfig> {
  try {
    const cookieStore = await cookies()
    const configCookie = cookieStore.get(COOKIE_NAME)
    if (configCookie) {
      return JSON.parse(configCookie.value)
    }
  } catch (e) {
    console.warn('[getBackendConfig] Failed to read config from cookie:', e)
  }
  return getDefaultConfig()
}
