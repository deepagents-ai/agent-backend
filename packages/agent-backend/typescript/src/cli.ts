// @ts-nocheck
/**
 * agent-backend CLI
 *
 * This module contains all CLI logic.
 *
 * Entry points:
 *   - Production: bin/agent-backend.js imports from dist/cli.js (compiled by vite)
 *   - Development: tsx --watch src/cli.ts (runs TypeScript source directly)
 *
 * Commands:
 * 1. daemon: Start agentbe-daemon (MCP + SSH-WS server)
 * 2. start-docker: Run the daemon image as a local container
 * 3. stop-docker: Stop and remove that container
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { execSync, spawn } from 'child_process'
import express from 'express'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import {
  buildDockerRunArgs,
  CONTAINER_NAME,
  CONTAINER_WORKSPACE,
  DEFAULT_DAEMON_IMAGE,
  envFileSetsAuthToken,
  hasRegistryHost,
  isMissingPlatformError,
  LOCAL_DAEMON_IMAGE,
  parseStartDockerArgs,
  resolveImage
} from './cli/docker-config.js'
import { LocalFilesystemBackend } from './index.js'
import { AgentBackendMCPServer, createWebSocketSSHServer } from './server/index.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PACKAGE_ROOT = join(__dirname, '..')

// Read version from package.json
const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf-8'))
const VERSION = pkg.version

// ─────────────────────────────────────────────────────────────────
// Main Dispatcher
// ─────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)
  const command = args[0]

  // Check for subcommands
  if (command === 'daemon') {
    await handleDaemon(args.slice(1))
    return
  }

  if (command === 'start-docker') {
    await handleStartDocker(args.slice(1))
    return
  }

  if (command === 'stop-docker') {
    await handleStopDocker()
    return
  }

  if (command === 'help' || command === '--help' || command === '-h') {
    printHelp()
    return
  }

  if (command === 'version' || command === '--version' || command === '-v') {
    console.log(`agent-backend v${VERSION}`)
    return
  }

  // Error: unknown command
  console.error(`❌ Unknown command: ${command || '(none)'}`)
  console.error('   Run "agent-backend help" for usage')
  process.exit(1)
}

// ─────────────────────────────────────────────────────────────────
// Daemon Command (MCP + SSH)
// ─────────────────────────────────────────────────────────────────

async function handleDaemon(args) {
  // Parse daemon-specific args
  const config = parseDaemonArgs(args)

  // Local-only mode (stdio MCP, no SSH, no HTTP)
  if (config.localOnly) {
    console.error('🌟 Starting agentbe-daemon (local stdio mode)...')
    console.error(`📁 Workspace: ${config.rootDir}`)
    if (config.scopePath) {
      console.error(`📂 Scope: ${config.scopePath}`)
    }
    console.error('')

    try {
      // Create base backend
      let backend = new LocalFilesystemBackend({
        rootDir: config.rootDir,
        isolation: config.isolation,
        shell: config.shell
      })

      // Apply static scoping if configured
      if (config.scopePath) {
        backend = backend.scope(config.scopePath)
      }

      // Create MCP server
      const mcpServer = new AgentBackendMCPServer(backend)

      // Use stdio transport for local development
      const transport = new StdioServerTransport()
      await mcpServer.getServer().connect(transport)

      // Server runs until stdin closes or process is killed
      console.error('✅ MCP server running on stdio')
      console.error('   (Use StdioClientTransport to connect)')
      console.error('')

    } catch (error) {
      console.error(`❌ Failed to start MCP server: ${error.message}`)
      if (error.stack) {
        console.error(error.stack)
      }
      process.exit(1)
    }
    return
  }

  // Full daemon mode (MCP + SSH-WS, optionally conventional SSH)
  console.error('🌟 Starting agentbe-daemon...')
  console.error(`📁 Workspace: ${config.rootDir}`)
  console.error(`🔌 Port: ${config.port}`)

  // Check if conventional SSH is requested
  if (config.conventionalSsh) {
    if (process.platform !== 'linux') {
      console.error('❌ Error: Conventional SSH (--conventional-ssh) requires Linux')
      console.error('   Use SSH-WS instead (enabled by default) which works on any platform')
      process.exit(1)
    }

    if (process.getuid() !== 0) {
      console.error('⚠️  Warning: Conventional SSH requires root privileges for user management')
      console.error('   Run with sudo or as root user')
    }

    // Validate sshd is installed
    const sshdPath = '/usr/sbin/sshd'
    try {
      execSync(`test -f ${sshdPath}`, { stdio: 'ignore' })
    } catch {
      console.error('❌ Error: SSH daemon not found at /usr/sbin/sshd')
      console.error('   Install openssh-server: apt-get install openssh-server')
      console.error('   Or remove --conventional-ssh to use SSH-WS instead')
      process.exit(1)
    }
  }

  try {
    // Start HTTP MCP server (with optional SSH-WS)
    const { httpServer, wsSshServer } = await startDaemonHttpServerWithSSH(config)

    let sshdProcess = null

    // Start conventional SSH daemon if requested
    if (config.conventionalSsh) {
      console.error(`👥 Conventional SSH Users: ${config.sshUsers.map(u => u.username).join(', ')}`)
      await setupSshUsers(config)
      sshdProcess = startSshDaemon(config)
    }

    // Set up signal handlers for graceful shutdown
    const shutdown = async () => {
      console.error('')
      console.error('🛑 Shutting down agentbe-daemon...')

      // Close SSH-WS server
      if (wsSshServer) {
        await wsSshServer.close()
        console.error('   ✓ SSH-WS server stopped')
      }

      // Close HTTP server
      await new Promise(resolve => httpServer.close(resolve))
      console.error('   ✓ MCP server stopped')

      // Stop conventional sshd if running
      if (sshdProcess) {
        sshdProcess.kill('SIGTERM')
        await new Promise(resolve => sshdProcess.on('exit', resolve))
        console.error('   ✓ Conventional SSH daemon stopped')
      }

      process.exit(0)
    }

    process.on('SIGTERM', shutdown)
    process.on('SIGINT', shutdown)

    // Monitor conventional sshd if running
    if (sshdProcess) {
      sshdProcess.on('exit', (code, signal) => {
        console.error(`❌ Conventional SSH daemon exited unexpectedly (code: ${code}, signal: ${signal})`)
        console.error('   agentbe-daemon shutting down...')
        httpServer.close(() => process.exit(1))
      })
    }

    console.error('')
    console.error('✅ agentbe-daemon is running')
    console.error(`   MCP endpoint: http://localhost:${config.port}/mcp`)
    console.error(`   Health check: http://localhost:${config.port}/health`)
    if (!config.disableSshWs) {
      console.error(`   SSH-WS endpoint: ws://localhost:${config.port}/ssh`)
    }
    if (config.conventionalSsh) {
      console.error(`   Conventional SSH: port ${config.sshPort}`)
    }
    if (config.authToken) {
      console.error(`   Auth: enabled (same token for MCP and SSH-WS)`)
    } else {
      console.error(`   Auth: disabled`)
    }
    console.error('')

  } catch (error) {
    console.error(`❌ Failed to start agentbe-daemon: ${error.message}`)
    if (error.stack) {
      console.error(error.stack)
    }
    process.exit(1)
  }
}

function parseDaemonArgs(args) {
  const config = {
    port: 3001,
    sshPort: 22,
    localOnly: false,
    // SSH-WS is enabled by default
    disableSshWs: false,
    // Conventional SSH is disabled by default
    conventionalSsh: false,
    sshUsers: [{ username: 'root', password: 'agents' }],
    sshPublicKey: null,
    sshAuthorizedKeys: null,
    sshHostKey: null
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    const next = args[i + 1]

    switch (arg) {
      case '--rootDir':
        config.rootDir = next
        i++
        break

      case '--scopePath':
        config.scopePath = next
        i++
        break

      case '--isolation':
        config.isolation = next
        i++
        break

      case '--shell':
        config.shell = next
        i++
        break

      case '--port':
        config.port = parseInt(next, 10)
        i++
        break

      case '--auth-token':
        config.authToken = next
        i++
        break

      case '--ssh-port':
        config.sshPort = parseInt(next, 10)
        i++
        break

      case '--local-only':
        config.localOnly = true
        break

      // SSH-WS options (enabled by default)
      case '--disable-ssh-ws':
        config.disableSshWs = true
        break

      case '--ssh-host-key':
        config.sshHostKey = next
        i++
        break

      // Conventional SSH options (disabled by default)
      case '--conventional-ssh':
        config.conventionalSsh = true
        break

      case '--ssh-users':
        // Parse user:pass,user:pass format
        config.sshUsers = next.split(',').map(pair => {
          const [username, password] = pair.split(':')
          if (!username || !password) {
            throw new Error(`Invalid --ssh-users format: ${pair}. Expected user:pass`)
          }
          return { username: username.trim(), password: password.trim() }
        })
        i++
        break

      case '--ssh-public-key':
        config.sshPublicKey = next
        i++
        break

      case '--ssh-authorized-keys':
        config.sshAuthorizedKeys = next
        i++
        break

      default:
        if (arg.startsWith('--')) {
          console.error(`❌ Error: unrecognized option: ${arg}`)
          console.error('   Run "agent-backend help" to see available options')
          process.exit(1)
        }
    }
  }

  // Validation
  if (!config.rootDir) {
    console.error('❌ Error: --rootDir is required')
    console.error('   Run "agent-backend help" for usage')
    process.exit(1)
  }

  if (config.port < 1024 || config.port > 65535) {
    console.error('❌ Error: --port must be between 1024-65535')
    process.exit(1)
  }

  if (config.sshPort < 1 || config.sshPort > 65535) {
    console.error('❌ Error: --ssh-port must be between 1-65535')
    process.exit(1)
  }

  if (config.isolation && !['auto', 'bwrap', 'software', 'none'].includes(config.isolation)) {
    console.error(`❌ Error: Invalid isolation mode "${config.isolation}"`)
    console.error('   Valid modes: auto, bwrap, software, none')
    process.exit(1)
  }

  if (config.shell && !['bash', 'sh', 'auto'].includes(config.shell)) {
    console.error(`❌ Error: Invalid shell "${config.shell}"`)
    console.error('   Valid shells: bash, sh, auto')
    process.exit(1)
  }

  return config
}

async function setupSshUsers(config) {
  console.error('👤 Setting up SSH users...')

  for (const user of config.sshUsers) {
    const { username, password } = user

    // Create user with home directory
    try {
      execSync(`useradd -m -s /bin/bash ${username}`, { stdio: 'pipe' })
      console.error(`   ✓ Created user: ${username}`)
    } catch (error) {
      // User might already exist
      console.log(`error: ${error}. Maybe expected if user already exists.`)
    }

    // Set password
    try {
      execSync(`echo "${username}:${password}" | chpasswd`, { stdio: 'pipe' })
      console.error(`   ✓ Set password for ${username}`)
    } catch (error) {
      console.error(`   ✗ Failed to set password for ${username}: ${error.message}`)
    }

    // Set up .ssh directory
    const sshDir = username === 'root' ? '/root/.ssh' : `/home/${username}/.ssh`
    try {
      execSync(`mkdir -p "${sshDir}"`, { stdio: 'pipe' })
      execSync(`touch "${sshDir}/authorized_keys"`, { stdio: 'pipe' })
      execSync(`chown -R ${username}:${username} "${sshDir}"`, { stdio: 'pipe' })
      execSync(`chmod 700 "${sshDir}"`, { stdio: 'pipe' })
      execSync(`chmod 600 "${sshDir}/authorized_keys"`, { stdio: 'pipe' })
    } catch (error) {
      console.error(`   ✗ Failed to set up .ssh directory: ${error.message}`)
    }
  }

  // Add SSH public key if provided (to first user)
  if (config.sshPublicKey) {
    const firstUser = config.sshUsers[0].username
    const sshDir = firstUser === 'root' ? '/root/.ssh' : `/home/${firstUser}/.ssh`
    try {
      execSync(`echo "${config.sshPublicKey}" >> "${sshDir}/authorized_keys"`, { stdio: 'pipe' })
      console.error(`   ✓ Added SSH public key for ${firstUser}`)
    } catch (error) {
      console.error(`   ✗ Failed to add SSH public key: ${error.message}`)
    }
  }

  // Copy authorized_keys file if provided
  if (config.sshAuthorizedKeys) {
    const firstUser = config.sshUsers[0].username
    const sshDir = firstUser === 'root' ? '/root/.ssh' : `/home/${firstUser}/.ssh`
    try {
      execSync(`cat "${config.sshAuthorizedKeys}" >> "${sshDir}/authorized_keys"`, { stdio: 'pipe' })
      console.error(`   ✓ Copied authorized_keys for ${firstUser}`)
    } catch (error) {
      console.error(`   ✗ Failed to copy authorized_keys: ${error.message}`)
    }
  }

  // Ensure password authentication is enabled
  try {
    execSync('mkdir -p /etc/ssh/sshd_config.d', { stdio: 'pipe' })
    execSync('echo "PasswordAuthentication yes" > /etc/ssh/sshd_config.d/agentbe-password.conf', { stdio: 'pipe' })
    console.error('   ✓ Enabled password authentication')
  } catch (error) {
    console.error(`   ✗ Failed to configure SSH: ${error.message}`)
  }
}

/**
 * Start HTTP server with MCP endpoint and optional SSH-WS endpoint
 */
async function startDaemonHttpServerWithSSH(config) {
  const app = express()

  // Create base backend
  const baseBackend = new LocalFilesystemBackend({
    rootDir: config.rootDir,
    isolation: config.isolation,
    shell: config.shell,
    preventDangerous: true
  })

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      version: VERSION,
      rootDir: config.rootDir,
      transports: {
        mcp: true,
        'ssh-ws': !config.disableSshWs,
        ssh: config.conventionalSsh || false
      }
    })
  })

  // MCP endpoint - creates scoped backend per request
  app.post('/mcp', async (req, res) => {
    // Validate auth token if configured
    if (config.authToken) {
      const authHeader = req.headers.authorization
      const expectedAuth = `Bearer ${config.authToken}`

      if (!authHeader || authHeader !== expectedAuth) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid or missing authentication token'
        })
        return
      }
    }

    // Read scope headers
    const requestedRootDir = req.headers['x-root-dir']
    const dynamicScopePath = req.headers['x-scope-path']

    // Validate X-Root-Dir matches configured rootDir (if provided and not 'undefined')
    if (requestedRootDir && requestedRootDir !== 'undefined' && requestedRootDir !== config.rootDir) {
      console.error(`[MCP] Root dir mismatch: requested=${requestedRootDir}, configured=${config.rootDir}`)
      res.status(403).json({
        error: 'Root directory mismatch',
        message: `Server is configured for ${config.rootDir}, not ${requestedRootDir}`
      })
      return
    }

    // Check for conflicting scope configuration
    if (config.scopePath && dynamicScopePath) {
      console.error(`[MCP] Scope conflict: static=${config.scopePath}, dynamic=${dynamicScopePath}`)
      res.status(400).json({
        error: 'Scope conflict',
        message: `Server was started with static scope '${config.scopePath}', but request also specified scope '${dynamicScopePath}'. Use one or the other, not both.`
      })
      return
    }

    // Determine effective scope (static from CLI or dynamic from header)
    const effectiveScopePath = config.scopePath || dynamicScopePath

    // Validate and create scoped backend if scope requested
    let backend = baseBackend
    if (effectiveScopePath) {
      // Validate scope path doesn't escape root
      const normalizedScope = effectiveScopePath.replace(/^\/+/, '').replace(/\.\.+/g, '')
      if (normalizedScope !== effectiveScopePath.replace(/^\/+/, '') || effectiveScopePath.includes('..')) {
        res.status(400).json({
          error: 'Invalid scope path',
          message: 'Scope path must not contain path traversal sequences'
        })
        return
      }
      backend = baseBackend.scope(normalizedScope)
      console.error(`[MCP] Request scoped to: ${normalizedScope}${config.scopePath ? ' (static)' : ' (dynamic)'}`)
    }

    // Create MCP server and transport for this request
    const mcpServer = new AgentBackendMCPServer(backend)
    const transport = new StreamableHTTPServerTransport()
    await mcpServer.getServer().connect(transport)

    await transport.handleRequest(req, res)
  })

  return await new Promise((resolve) => {
    const httpServer = app.listen(config.port, () => {
      console.error('🔌 HTTP server started')
      console.error(`   Port: ${config.port}`)
      console.error(`   Auth: ${config.authToken ? 'enabled (token required)' : 'disabled (open access)'}`)
      if (config.scopePath) {
        console.error(`   Scope: ${config.scopePath} (static)`)
      }

      // Add SSH-WS endpoint if not disabled
      let wsSshServer = null
      if (!config.disableSshWs) {
        wsSshServer = createWebSocketSSHServer(httpServer, {
          rootDir: config.rootDir,
          authToken: config.authToken,
          hostKeyPath: config.sshHostKey,
          shell: config.shell
        })
        console.error('🔐 SSH-WS server started')
        console.error(`   Endpoint: ws://0.0.0.0:${config.port}/ssh`)
      }

      resolve({ httpServer, wsSshServer })
    })
  })
}

function startSshDaemon(config) {
  console.error('🚀 Starting SSH daemon...')

  const sshdArgs = ['-D', '-e', '-p', String(config.sshPort)]
  const sshdProcess = spawn('/usr/sbin/sshd', sshdArgs, {
    stdio: ['ignore', 'inherit', 'inherit']
  })

  sshdProcess.on('spawn', () => {
    console.error('   ✓ SSH daemon started')
  })

  sshdProcess.on('error', (error) => {
    console.error(`   ✗ Failed to start SSH daemon: ${error.message}`)
    process.exit(1)
  })

  return sshdProcess
}

// ─────────────────────────────────────────────────────────────────
// Local Docker Launcher (start-docker / stop-docker)
// ─────────────────────────────────────────────────────────────────

const HEALTH_TIMEOUT_MS = 120_000

async function handleStartDocker(args) {
  const { config, error } = parseStartDockerArgs(args, process.env)
  if (error) {
    console.error(`❌ ${error}`)
    console.error('   Run "agent-backend help" for usage')
    process.exit(1)
  }

  if (!dockerAvailable()) {
    console.error('❌ Docker is required but is not reachable (is Docker running?)')
    console.error('   Install Docker: https://docs.docker.com/get-docker/')
    process.exit(1)
  }

  let repoRoot = null
  if (config.build || config.dev) {
    repoRoot = findSourceCheckout()
    if (!repoRoot) {
      const flag = config.build ? '--build' : '--dev'
      console.error(`❌ ${flag} requires an agent-backend source checkout (agentbe-daemon/docker/Dockerfile not found)`)
      console.error(`   Omit ${flag} to run the published image: ${DEFAULT_DAEMON_IMAGE}`)
      process.exit(1)
    }
  }

  if (config.workspace) {
    config.workspace = resolve(config.workspace)
    mkdirSync(config.workspace, { recursive: true })
  }
  if (config.envFile) {
    config.envFile = resolve(config.envFile)
  }

  try {
    if (config.build || (config.dev && !imageExists(LOCAL_DAEMON_IMAGE))) {
      await buildLocalImage(repoRoot)
    }

    let devMounts
    if (config.dev) {
      devMounts = await prepareDevMounts(repoRoot)
    }

    const platform = config.build || config.dev ? undefined : await pullImage(resolveImage(config))

    if (containerExists()) {
      console.log(`   Replacing existing ${CONTAINER_NAME} container...`)
      await runCommand(['docker', 'rm', '-f', CONTAINER_NAME])
    }

    const tokenInEnvFile = config.envFile && existsSync(config.envFile)
      && envFileSetsAuthToken(readFileSync(config.envFile, 'utf-8'))
    if (!config.authToken && !tokenInEnvFile) {
      console.warn('⚠️  No auth token set: the daemon is unauthenticated. Use --auth-token or AUTH_TOKEN.')
    }
    if (!config.workspace) {
      console.warn(`ℹ️  No --workspace given: files live only inside the container and are lost when it is removed.`)
    }

    const runArgs = buildDockerRunArgs(config, devMounts, platform)
    console.log(`🚀 Starting ${CONTAINER_NAME} (${resolveImage(config)})...`)

    if (config.foreground) {
      process.exit(await runForeground(runArgs))
    }

    await runCommand(['docker', ...runArgs])

    if (!(await waitForHealth(config.port, HEALTH_TIMEOUT_MS))) {
      console.error(`❌ Daemon did not become healthy within ${HEALTH_TIMEOUT_MS / 1000}s. Recent logs:`)
      try {
        console.error(execSync(`docker logs --tail 50 ${CONTAINER_NAME}`, { encoding: 'utf8', stdio: 'pipe' }))
      } catch {
        // Container may have exited and been removed
      }
      console.error(`   Container left in place for inspection: docker logs ${CONTAINER_NAME}`)
      process.exit(1)
    }

    const host = ['0.0.0.0', '127.0.0.1'].includes(config.bind) ? 'localhost' : config.bind
    console.log(`✅ ${CONTAINER_NAME} is running`)
    console.log(`   MCP: http://${host}:${config.port}/mcp`)
    console.log('')
    console.log('   Connect with RemoteFilesystemBackend:')
    console.log(`     host: '${host}', port: ${config.port}, rootDir: '${CONTAINER_WORKSPACE}',`)
    console.log(config.authToken || tokenInEnvFile
      ? `     authToken: <your token>`
      : `     (no authToken required)`)
    console.log('')
    console.log('   Stop with: agent-backend stop-docker')
  } catch (err) {
    console.error(`❌ Failed to start ${CONTAINER_NAME}: ${err.message}`)
    process.exit(1)
  }
}

async function handleStopDocker() {
  if (!dockerAvailable()) {
    console.error('❌ Docker is required but is not reachable (is Docker running?)')
    process.exit(1)
  }
  if (!containerExists()) {
    console.log(`ℹ️  No ${CONTAINER_NAME} container is running`)
    return
  }
  try {
    await runCommand(['docker', 'rm', '-f', CONTAINER_NAME])
    console.log(`✅ ${CONTAINER_NAME} stopped and removed`)
  } catch (err) {
    console.error(`❌ Failed to stop ${CONTAINER_NAME}: ${err.message}`)
    process.exit(1)
  }
}

function dockerAvailable() {
  try {
    execSync('docker info', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function containerExists() {
  const out = execSync(
    `docker ps -a --filter "name=^${CONTAINER_NAME}$" --format "{{.Names}}"`,
    { encoding: 'utf8', stdio: 'pipe' }
  ).trim()
  return out.split('\n').includes(CONTAINER_NAME)
}

function imageExists(image) {
  try {
    execSync(`docker image inspect ${image}`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/** Walk up from the installed package looking for the repo's daemon Dockerfile. */
function findSourceCheckout() {
  let dir = PACKAGE_ROOT
  while (true) {
    if (existsSync(join(dir, 'agentbe-daemon', 'docker', 'Dockerfile'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/**
 * Pull a published image. Returns a forced platform when the image has no
 * build for this host (falls back to emulated linux/amd64), else undefined.
 */
async function pullImage(image) {
  if (!hasRegistryHost(image) && imageExists(image)) {
    return undefined
  }
  console.log(`   Pulling ${image}...`)
  try {
    await runCommand(['docker', 'pull', image])
    return undefined
  } catch (err) {
    if (isMissingPlatformError(err.message)) {
      console.log(`ℹ️  ${image} has no build for this architecture; running linux/amd64 under emulation (slower)`)
      await runCommand(['docker', 'pull', '--platform', 'linux/amd64', image])
      return 'linux/amd64'
    }
    if (imageExists(image)) {
      console.warn(`⚠️  Could not pull ${image}; using the local copy`)
      return undefined
    }
    throw err
  }
}

async function buildLocalImage(repoRoot) {
  console.log('   Building agent-backend TypeScript package...')
  await runCommand(['pnpm', '--filter=agent-backend', 'build'], { cwd: repoRoot, stream: true })
  console.log(`   Building ${LOCAL_DAEMON_IMAGE}...`)
  await runCommand([
    'docker', 'build',
    '-f', join('agentbe-daemon', 'docker', 'Dockerfile'),
    '-t', LOCAL_DAEMON_IMAGE,
    '.'
  ], { cwd: repoRoot, stream: true })
}

async function prepareDevMounts(repoRoot) {
  const deployDir = join(repoRoot, 'tmp', 'deploy')
  console.log('   Refreshing standalone deploy folder for hot reload...')
  rmSync(deployDir, { recursive: true, force: true })
  await runCommand(
    ['pnpm', '--filter=agent-backend', 'deploy', '--prod', '--legacy', deployDir],
    { cwd: repoRoot, stream: true }
  )
  return { deployDir, srcDir: join(PACKAGE_ROOT, 'src') }
}

function runForeground(runArgs) {
  return new Promise((resolvePromise) => {
    const proc = spawn('docker', runArgs, { stdio: 'inherit' })
    let stopping = false
    const stop = () => {
      if (stopping) return
      stopping = true
      console.log(`\n   Stopping ${CONTAINER_NAME}...`)
      spawn('docker', ['stop', CONTAINER_NAME], { stdio: 'ignore' })
    }
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
    proc.on('close', (code) => resolvePromise(code ?? 1))
    proc.on('error', (err) => {
      console.error(`❌ ${err.message}`)
      resolvePromise(1)
    })
  })
}

async function waitForHealth(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await globalThis.fetch(`http://127.0.0.1:${port}/health`)
      if (res.status === 200) return true
    } catch {
      // Not listening yet
    }
    await new Promise(r => setTimeout(r, 1000))
  }
  return false
}

function runCommand(command, { cwd, stream = false } = {}) {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn(command[0], command.slice(1), {
      cwd,
      stdio: stream ? 'inherit' : ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''

    proc.stdout?.on('data', (data) => {
      stdout += data.toString()
    })

    proc.stderr?.on('data', (data) => {
      stderr += data.toString()
    })

    proc.on('close', (code) => {
      if (code === 0) {
        resolvePromise(stdout)
      } else {
        reject(new Error(`${command.join(' ')} exited with code ${code}${stderr || stdout ? `: ${stderr || stdout}` : ''}`))
      }
    })

    proc.on('error', reject)
  })
}

// ─────────────────────────────────────────────────────────────────
// Help
// ─────────────────────────────────────────────────────────────────

function printHelp() {
  console.log(`
🚀 agent-backend v${VERSION} - Agent Backend CLI

USAGE:
  agent-backend <command> [options]

COMMANDS:
  daemon                 Start agentbe-daemon (MCP + SSH-WS server)
  start-docker           Run agentbe-daemon in a local Docker container
  stop-docker            Stop and remove that container
  version                Show version
  help                   Show this help message

DAEMON COMMAND:
  agent-backend daemon --rootDir <path> [OPTIONS]

  Starts agentbe-daemon with MCP HTTP server and SSH-over-WebSocket.

  Modes:
  1. Local-only mode (--local-only): Stdio MCP server for local dev
  2. Full mode (default): MCP + SSH-WS on single port, works on any platform
  3. With conventional SSH (--conventional-ssh): Adds sshd, requires Linux + root

  Required Options:
    --rootDir <path>       Root directory to serve

  Optional - Mode:
    --local-only           Run MCP server via stdio (no HTTP, no SSH). Works on any platform.
                           Perfect for local development with LocalFilesystemBackend.

  Optional - Scoping:
    --scopePath <path>     Static scope path within rootDir. All operations are restricted
                           to this subdirectory.

  Optional - Server:
    --port <port>          HTTP/WebSocket server port (default: 3001)
    --auth-token <tok>     Bearer token for authentication (used for BOTH MCP and SSH-WS)
    --isolation <mode>     Command isolation: auto|bwrap|software|none (default: auto)
    --shell <shell>        Shell to use: bash|sh|auto (default: auto)

  Optional - SSH-WS (enabled by default):
    --disable-ssh-ws       Disable SSH-over-WebSocket endpoint
    --ssh-host-key <path>  Path to SSH host key (auto-generated if not provided)

  Optional - Conventional SSH (disabled by default, requires Linux + root):
    --conventional-ssh     Enable conventional SSH daemon (sshd)
    --ssh-port <port>      Conventional SSH port (default: 22)
    --ssh-users <users>    Comma-separated user:password pairs (default: root:agents)
    --ssh-public-key <key> SSH public key to add to authorized_keys
    --ssh-authorized-keys <path>  Path to authorized_keys file

DOCKER MANAGEMENT:
  agent-backend start-docker [OPTIONS]

  Runs the daemon image as a container named agentbe-daemon, replacing any
  existing one. Connect with RemoteFilesystemBackend (host: localhost).

  Options:
    --port <port>          Host and container port (default: 3001)
    --bind <addr>          Host address to publish on (default: 127.0.0.1)
    --auth-token <tok>     Auth token (default: $AUTH_TOKEN, else none)
    --workspace <path>     Host directory mounted at /var/workspace
    --env-file <path>      Env file passed to the container
    --image <ref>          Image to run (default: ghcr.io/aspects-ai/agentbe-daemon:latest)
    --build                Build the image from source first (source checkout only)
    --dev                  Hot-reload from mounted source (source checkout only)
    --foreground           Stay attached instead of detaching

  agent-backend stop-docker

  Stops and removes the agentbe-daemon container.

EXAMPLES:
  # Default mode: MCP + SSH-WS on single port (works on any platform)
  agent-backend daemon --rootDir /tmp/agentbe-workspace

  # With authentication (same token for MCP and SSH-WS)
  agent-backend daemon --rootDir /tmp/agentbe-workspace \\
    --auth-token secret123

  # Local-only mode (stdio, no HTTP)
  agent-backend daemon --rootDir /tmp/agentbe-workspace --local-only

  # With conventional SSH (Linux only, requires root)
  agent-backend daemon --rootDir /var/workspace \\
    --conventional-ssh --ssh-users "agent:secret"

  # Disable SSH-WS, use only conventional SSH (Linux only)
  agent-backend daemon --rootDir /var/workspace \\
    --disable-ssh-ws --conventional-ssh

  # Custom port
  agent-backend daemon --rootDir /tmp/agentbe-workspace --port 8080

  # Run the daemon in Docker with a persistent workspace
  agent-backend start-docker --workspace ./workspace --auth-token secret123

TRANSPORTS:
  SSH-WS (default, recommended):
  - Single port for everything (MCP + SSH over WebSocket)
  - Works through HTTP load balancers and proxies
  - Unified authentication (one token for all)
  - Client: transport: 'ssh-ws' (default)

  Conventional SSH (opt-in):
  - Requires separate sshd process (Linux + root)
  - Two ports (MCP on 3001, SSH on 22)
  - Separate authentication (SSH users/keys)
  - Client: transport: 'ssh'

NOTES:
  - SSH-WS is enabled by default and works on any platform
  - Conventional SSH (--conventional-ssh) requires Linux and root privileges
  - Use --auth-token to secure endpoints (recommended for production)
  - RemoteFilesystemBackend defaults to ssh-ws transport
`)
}

// ─────────────────────────────────────────────────────────────────
// Run
// ─────────────────────────────────────────────────────────────────

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
