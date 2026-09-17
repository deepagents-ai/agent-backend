/**
 * URL scheme and header rules shared by both daemon channels (MCP over HTTP and SSH-over-WebSocket).
 */

/** Headers the library sets itself; caller-supplied headers can never override these */
const RESERVED_HEADERS = new Set(['authorization', 'x-root-dir', 'x-scope-path'])

/**
 * Pick the URL scheme for a daemon channel.
 * An explicit `secure` wins; otherwise port 443 implies TLS.
 */
export function daemonScheme(channel: 'http' | 'ws', port: number, secure?: boolean): string {
  const tls = secure ?? port === 443
  return tls ? `${channel}s` : channel
}

/**
 * Merge caller-supplied headers under the library's own headers.
 * Entries that collide (case-insensitively) with a reserved header or with any of `own` are dropped.
 */
export function mergeDaemonHeaders(
  extra: Record<string, string> | undefined,
  own: Record<string, string>
): Record<string, string> {
  const ownKeys = new Set(Object.keys(own).map((k) => k.toLowerCase()))
  const merged: Record<string, string> = {}
  for (const [key, value] of Object.entries(extra ?? {})) {
    const lower = key.toLowerCase()
    if (RESERVED_HEADERS.has(lower) || ownKeys.has(lower)) continue
    merged[key] = value
  }
  return { ...merged, ...own }
}
