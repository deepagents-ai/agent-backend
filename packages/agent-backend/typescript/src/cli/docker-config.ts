/**
 * Local Docker launcher configuration (start-docker)
 * Pure parsing and argument building, kept separate from cli.ts for testability
 */

export const DEFAULT_DAEMON_IMAGE = 'ghcr.io/deepagents-ai/agentbe-daemon:latest'
export const LOCAL_DAEMON_IMAGE = 'agentbe-daemon:latest'
export const CONTAINER_NAME = 'agentbe-daemon'
export const CONTAINER_WORKSPACE = '/var/workspace'

export interface StartDockerConfig {
  port: number
  bind: string
  authToken?: string
  workspace?: string
  envFile?: string
  image?: string
  build: boolean
  dev: boolean
  foreground: boolean
}

export interface StartDockerParseResult {
  config?: StartDockerConfig
  error?: string
}

const VALUE_FLAGS = ['--port', '--bind', '--auth-token', '--workspace', '--env-file', '--image'] as const

/**
 * Parse start-docker arguments. `env` supplies the launcher's AUTH_TOKEN fallback.
 */
export function parseStartDockerArgs(
  args: string[],
  env: Record<string, string | undefined> = {}
): StartDockerParseResult {
  const config: StartDockerConfig = {
    port: 3001,
    bind: '127.0.0.1',
    build: false,
    dev: false,
    foreground: false,
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    if ((VALUE_FLAGS as readonly string[]).includes(arg)) {
      const next = args[i + 1]
      if (!next || next.startsWith('--')) {
        return { error: `${arg} requires a value` }
      }
      i++
      switch (arg) {
        case '--port': {
          const port = Number(next)
          if (!Number.isInteger(port) || port < 1024 || port > 65535) {
            return { error: '--port must be an integer between 1024 and 65535' }
          }
          config.port = port
          break
        }
        case '--bind':
          config.bind = next
          break
        case '--auth-token':
          config.authToken = next
          break
        case '--workspace':
          config.workspace = next
          break
        case '--env-file':
          config.envFile = next
          break
        case '--image':
          config.image = next
          break
      }
      continue
    }

    switch (arg) {
      case '--build':
        config.build = true
        break
      case '--dev':
        config.dev = true
        break
      case '--foreground':
        config.foreground = true
        break
      default:
        return { error: arg.startsWith('--') ? `Unknown option: ${arg}` : `Unexpected argument: ${arg}` }
    }
  }

  if (config.image && (config.build || config.dev)) {
    return { error: '--image cannot be combined with --build or --dev' }
  }

  if (config.authToken === undefined && env.AUTH_TOKEN) {
    config.authToken = env.AUTH_TOKEN
  }

  return { config }
}

/** Image the launcher will run for a given config. */
export function resolveImage(config: StartDockerConfig): string {
  if (config.build || config.dev) return LOCAL_DAEMON_IMAGE
  return config.image ?? DEFAULT_DAEMON_IMAGE
}

export interface DevMounts {
  /** Standalone production dependency folder (pnpm deploy output) */
  deployDir: string
  /** The package's TypeScript source directory */
  srcDir: string
}

/**
 * Build the `docker run` argument list (excluding the leading `docker`).
 * `workspace` must already be absolute; `dev` mounts are required when config.dev is set.
 * `platform` forces an image platform (e.g. emulated linux/amd64 on arm64 hosts).
 */
export function buildDockerRunArgs(config: StartDockerConfig, dev?: DevMounts, platform?: string): string[] {
  const args = ['run', '--name', CONTAINER_NAME]
  args.push(config.foreground ? '--rm' : '-d')
  if (platform) args.push('--platform', platform)
  args.push('-p', `${config.bind}:${config.port}:${config.port}`)

  // --env-file first: explicit -e values take precedence over it
  if (config.envFile) args.push('--env-file', config.envFile)
  args.push('-e', `PORT=${config.port}`)
  if (config.authToken) args.push('-e', `AUTH_TOKEN=${config.authToken}`)

  if (config.workspace) args.push('-v', `${config.workspace}:${CONTAINER_WORKSPACE}`)

  if (config.dev) {
    if (!dev) throw new Error('dev mounts are required when dev is enabled')
    args.push(
      '-v', `${dev.deployDir}:/app/agent-backend:ro`,
      '-v', `${dev.srcDir}:/app/agent-backend/src:ro`,
      '-e', 'USE_LOCAL_BUILD=1'
    )
  }

  args.push(resolveImage(config))
  return args
}

/**
 * Whether an image reference names a registry host (e.g. ghcr.io/..., localhost:5000/...).
 * References without one, like `agentbe-daemon:latest`, may be purely local images.
 */
export function hasRegistryHost(image: string): boolean {
  const slash = image.indexOf('/')
  if (slash === -1) return false
  const first = image.slice(0, slash)
  return first.includes('.') || first.includes(':') || first === 'localhost'
}

/** Whether a failed pull means the image has no build for this host's architecture. */
export function isMissingPlatformError(message: string): boolean {
  return /no matching manifest/i.test(message)
}

/** Whether an env file's contents set a non-empty AUTH_TOKEN. */
export function envFileSetsAuthToken(contents: string): boolean {
  return contents
    .split('\n')
    .some((line) => /^\s*AUTH_TOKEN\s*=\s*\S/.test(line))
}
