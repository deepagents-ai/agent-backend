#!/usr/bin/env node

/**
 * agent-backend CLI
 *
 * Commands:
 * 1. Start MCP servers for different backend types (default command)
 * 2. start-remote: Start Docker-based remote backend service
 * 3. stop-remote: Stop Docker-based remote backend service
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { execSync, spawn } from 'child_process'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import express from 'express'
import { AgentBackendMCPServer } from '../dist/server/index.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PACKAGE_ROOT = join(__dirname, '..')
const DEPLOY_DIR = join(PACKAGE_ROOT, 'deploy')

// ─────────────────────────────────────────────────────────────────
// Main Dispatcher
// ─────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)
  const command = args[0]

  // Check for subcommands
  if (command === 'start-remote') {
    await handleStartRemote(args.slice(1))
    return
  }

  if (command === 'stop-remote') {
    await handleStopRemote()
    return
  }

  if (command === 'help' || command === '--help' || command === '-h') {
    printHelp()
    return
  }

  // Default: start MCP server
  await startMCPServer(args)
}

// ─────────────────────────────────────────────────────────────────
// MCP Server (default command)
// ─────────────────────────────────────────────────────────────────

function parseArgs(args) {
  const config = {}

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    const next = args[i + 1]

    switch (arg) {
      // Daemon options
      case '--rootDir':
        config.rootDir = next
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

      // MCP server options
      case '--mcp-port':
        config.mcpPort = parseInt(next, 10)
        i++
        break

      case '--mcp-auth-token':
        config.mcpAuthToken = next
        i++
        break

      case '--help':
      case '-h':
        printHelp()
        process.exit(0)
        break

      default:
        if (arg.startsWith('--')) {
          console.error(`❌ Error: unrecognized option: ${arg}`)
          console.error('   Run with --help to see available options')
          process.exit(1)
        }
    }
  }

  // Validation
  if (!config.rootDir) {
    console.error('❌ Error: --rootDir is required')
    printHelp()
    process.exit(1)
  }

  // Validate isolation mode
  if (config.isolation && !['auto', 'bwrap', 'software', 'none'].includes(config.isolation)) {
    console.error(`❌ Error: Invalid isolation mode "${config.isolation}"`)
    console.error('   Valid modes: auto, bwrap, software, none')
    process.exit(1)
  }

  // Validate shell
  if (config.shell && !['bash', 'sh', 'auto'].includes(config.shell)) {
    console.error(`❌ Error: Invalid shell "${config.shell}"`)
    console.error('   Valid shells: bash, sh, auto')
    process.exit(1)
  }

  // MCP port validation
  if (config.mcpPort !== undefined) {
    if (config.mcpPort < 1024 || config.mcpPort > 65535) {
      console.error('❌ Error: --mcp-port must be between 1024-65535')
      process.exit(1)
    }
  }

  return config
}

async function startMCPServer(args) {
  const config = parseArgs(args)

  console.error(`🚀 Starting agentbed (agent backend daemon)...`)
  console.error(`📁 Root directory: ${config.rootDir}`)
  console.error(`🔒 Isolation: ${config.isolation || 'auto'}`)

  try {
    // Create MCP server directly with config (NO Backend abstraction!)
    const mcpServer = new AgentBackendMCPServer({
      rootDir: config.rootDir,
      isolation: config.isolation,
      shell: config.shell,
      preventDangerous: true
    })

    // Choose transport mode based on config
    if (config.mcpPort) {
      await startHttpServer(mcpServer, config)
    } else {
      // Connect stdio transport
      const transport = new StdioServerTransport()
      await mcpServer.getServer().connect(transport)

      console.error(`✅ agentbed running on stdio`)
      console.error(`   Ready to receive MCP requests`)
    }

  } catch (error) {
    console.error(`❌ Failed to start agentbed: ${error.message}`)
    if (error.stack) {
      console.error(error.stack)
    }
    process.exit(1)
  }
}

/**
 * Start HTTP server for MCP
 */
async function startHttpServer(mcpServer, config) {
  const app = express()

  // Create transport and connect once
  const transport = new StreamableHTTPServerTransport()
  await mcpServer.getServer().connect(transport)

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      rootDir: config.rootDir
    })
  })

  // MCP endpoint - transport handles the request
  app.post('/mcp', async (req, res) => {
    // Validate auth token if configured
    if (config.mcpAuthToken) {
      const authHeader = req.headers.authorization
      const expectedAuth = `Bearer ${config.mcpAuthToken}`

      if (!authHeader || authHeader !== expectedAuth) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid or missing authentication token'
        })
        return
      }
    }

    await transport.handleRequest(req, res)
  })

  await new Promise((resolve) => {
    app.listen(config.mcpPort, () => {
      console.error(`✅ agentbed running on HTTP`)
      console.error(`   Port: ${config.mcpPort}`)
      console.error(`   Auth: ${config.mcpAuthToken ? 'enabled (token required)' : 'disabled (open access)'}`)
      console.error(`   Health: http://localhost:${config.mcpPort}/health`)
      console.error(`   Endpoint: http://localhost:${config.mcpPort}/mcp`)
      resolve()
    })
  })
}

// ─────────────────────────────────────────────────────────────────
// Docker Remote Backend Management
// ─────────────────────────────────────────────────────────────────

async function handleStartRemote(args) {
  const shouldBuild = args.includes('--build')

  console.log('🚀 Starting Agent Backend remote service...')

  // Check if Docker is available
  try {
    execSync('docker --version', { stdio: 'ignore' })
  } catch {
    console.error('❌ Docker is required for the remote backend')
    console.error('   Please install Docker Desktop: https://www.docker.com/products/docker-desktop/')
    process.exit(1)
  }

  try {
    // Build image if requested
    if (shouldBuild) {
      console.log('   Building Docker image...')
      await buildImage()
      console.log('   ✅ Docker image built successfully')
    }

    // Check if service is already running
    try {
      const output = execSync('docker ps --filter "name=agentbe-remote" --format "{{.Names}}"', {
        encoding: 'utf8',
        stdio: 'pipe'
      }).trim()

      if (output.includes('agentbe-remote')) {
        if (shouldBuild) {
          console.log('   Restarting container with new image...')
          // Stop and remove existing container
          await runCommand(['docker', 'stop', 'agentbe-remote-backend']).catch(() => { })
          await runCommand(['docker', 'rm', 'agentbe-remote-backend']).catch(() => { })
        } else {
          console.log('✅ Remote backend is already running')
          console.log('   SSH available at: root@localhost:2222')
          console.log('   Default password: agents')
          return
        }
      }
    } catch {
      // Service not running, continue
    }

    try {
      // Use docker-compose if available
      try {
        await runDockerCompose()
      } catch {
        // Fallback to direct docker run
        await runDockerDirect(shouldBuild)
      }

      // Wait a moment for service to start
      await new Promise(resolve => setTimeout(resolve, 2000))

      console.log('✅ Remote backend started successfully')
      console.log('   SSH available at: root@localhost:2222')
      console.log('   MCP available at: http://localhost:3001')
      console.log('   Default password: agents')
      console.log('')
      console.log('   Connect using RemoteFilesystemBackend from your application')

    } catch (error) {
      throw new Error(`Failed to start remote backend: ${error.message}`)
    }
  } catch (error) {
    console.error(`❌ ${error.message}`)
    process.exit(1)
  }
}

async function handleStopRemote() {
  console.log('🛑 Stopping Agent Backend remote service...')

  try {
    // Try docker-compose down first
    try {
      await runCommand([
        'docker-compose', '-f', join(DEPLOY_DIR, 'docker', 'docker-compose.yml'), 'down'
      ])
    } catch {
      // Fallback to stopping containers directly
      const containers = execSync(
        'docker ps --filter "name=agentbe-remote" --format "{{.Names}}"',
        { encoding: 'utf8', stdio: 'pipe' }
      ).trim().split('\n').filter(name => name.trim())

      for (const container of containers) {
        if (container.trim()) {
          await runCommand(['docker', 'stop', container.trim()])
          await runCommand(['docker', 'rm', container.trim()])
        }
      }
    }

    console.log('✅ Remote backend stopped')

  } catch (error) {
    console.error(`❌ Failed to stop remote backend: ${error.message}`)
    process.exit(1)
  }
}

async function runDockerCompose() {
  console.log('   Using docker-compose...')

  await runCommand([
    'docker-compose',
    '-f', join(DEPLOY_DIR, 'docker', 'docker-compose.yml'),
    'up', '-d'
  ])
}

async function buildImage() {
  await runCommand([
    'docker', 'build',
    '-f', join(DEPLOY_DIR, 'docker', 'Dockerfile.runtime'),
    '-t', 'agentbe/remote-backend:latest',
    PACKAGE_ROOT
  ])
}

async function runDockerDirect(shouldBuild) {
  console.log('   Using direct docker run...')

  // Build image if not already built
  if (!shouldBuild) {
    console.log('   Building Docker image...')
    await buildImage()
  }

  // Run container
  await runCommand([
    'docker', 'run', '-d',
    '--name', 'agentbe-remote-backend',
    '-p', '2222:22',
    'agentbe/remote-backend:latest'
  ])
}

function runCommand(command) {
  return new Promise((resolve, reject) => {
    const process = spawn(command[0], command.slice(1), {
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''

    process.stdout?.on('data', (data) => {
      stdout += data.toString()
    })

    process.stderr?.on('data', (data) => {
      stderr += data.toString()
    })

    process.on('close', (code) => {
      if (code === 0) {
        resolve(stdout)
      } else {
        reject(new Error(`Command failed with exit code ${code}: ${stderr || stdout}`))
      }
    })

    process.on('error', reject)
  })
}

// ─────────────────────────────────────────────────────────────────
// Help
// ─────────────────────────────────────────────────────────────────

function printHelp() {
  console.log(`
🚀 agentbed (agent-backend) - Agent Backend Daemon

Serves a local filesystem remotely via MCP over HTTP.
Runs alongside SSH daemon to provide both direct filesystem access (SSH)
and MCP tool execution (HTTP).

USAGE:
  agent-backend [COMMAND] [OPTIONS]

COMMANDS:
  (default)              Start agentbed (agent backend daemon)
  start-remote [--build] Start Docker container with agentbed + SSH daemon
  stop-remote            Stop Docker container
  help                   Show this help message

DAEMON OPTIONS (default command):

  Common Options:
    --rootDir <path>       Root directory to serve (required)

  Daemon Options:
    --mcp-port <port>      Run HTTP server on port (default: stdio mode)
                           Port must be between 1024-65535
    --mcp-auth-token <tok> Authentication token for HTTP endpoint
                           Clients must send: Authorization: Bearer <token>

  Filesystem Options:
    --isolation <mode>     Isolation mode: auto, bwrap, software, none (default: auto)
    --shell <shell>        Shell to use: bash, sh, auto (default: auto)

REMOTE MANAGEMENT OPTIONS:

  start-remote Options:
    --build                Force rebuild the Docker image

EXAMPLES:

  # Start agentbed with stdio (for local development)
  agent-backend --rootDir /tmp/workspace

  # Start agentbed with HTTP (for remote deployment)
  agent-backend --rootDir /workspace --mcp-port 3001

  # Start agentbed with HTTP and authentication
  agent-backend --rootDir /workspace --mcp-port 3001 \\
    --mcp-auth-token my-secret-token

  # Start with bubblewrap isolation (Linux only)
  agent-backend --rootDir /workspace --mcp-port 3001 --isolation bwrap

  # Start Docker container with agentbed + SSH daemon
  agent-backend start-remote

  # Stop Docker container
  agent-backend stop-remote

  # Rebuild and restart Docker container
  agent-backend start-remote --build

NOTES:
  - Stdio transport is default (for local development via MCP client)
  - HTTP transport is for remote deployments (--mcp-port)
  - HTTP without --mcp-auth-token has NO authentication (open access)
  - Use --mcp-auth-token to secure HTTP endpoints (required for production)
  - The daemon serves its LOCAL filesystem - it's "remote" from the client's perspective
  - Clients use RemoteFilesystemBackend to connect via SSH + HTTP MCP
  - Docker deployment includes both SSH daemon and agentbed on same container
`)
}

// ─────────────────────────────────────────────────────────────────
// Run
// ─────────────────────────────────────────────────────────────────

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
