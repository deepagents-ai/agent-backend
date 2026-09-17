/**
 * Daemon auth token checks.
 */

import { createHash, timingSafeEqual } from 'crypto'

/** Environment variables that carry the daemon's credential and must never reach child processes */
export const DAEMON_SECRET_ENV_VARS = ['AUTH_TOKEN', 'MCP_AUTH_TOKEN'] as const

/**
 * Compare a supplied secret with the expected one in constant time.
 * Both sides are hashed first so the comparison is fixed-length and leaks neither content nor length.
 */
export function secretsEqual(supplied: string | null | undefined, expected: string): boolean {
  if (typeof supplied !== 'string') return false
  const a = createHash('sha256').update(supplied).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

/** Remove the daemon's credentials from this process's environment so spawned children don't inherit them */
export function stripDaemonSecretsFromEnv(env: NodeJS.ProcessEnv = process.env): void {
  for (const name of DAEMON_SECRET_ENV_VARS) {
    delete env[name]
  }
}
