import { describe, it, expect } from 'vitest'
import { spawn } from 'child_process'
import { randomBytes } from 'crypto'
import { join } from 'path'
import { tmpdir } from 'os'

function getTempDir(): string {
  return join(tmpdir(), `agentbe-cli-test-${randomBytes(8).toString('hex')}`)
}

describe('agentbe-server CLI - MCP Server Mode', () => {
  it('should start local MCP server', async () => {
    const rootDir = getTempDir()

    const proc = spawn('node', [
      './bin/agentbe-server.js',
      '--backend', 'local',
      '--rootDir', rootDir
    ], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe']
    })

    let output = ''
    proc.stdout.on('data', (data) => {
      output += data.toString()
    })

    // Wait for initialization
    await new Promise(resolve => setTimeout(resolve, 2000))

    // Send initialize request (MCP protocol)
    const initRequest = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'test-client',
          version: '1.0.0'
        }
      }
    })

    proc.stdin.write(initRequest + '\n')

    // Wait for response
    await new Promise(resolve => setTimeout(resolve, 1000))

    // Should receive a response
    expect(output.length).toBeGreaterThan(0)

    proc.kill()
  }, 10000)

  it('should start memory MCP server', async () => {
    const proc = spawn('node', [
      './bin/agentbe-server.js',
      '--backend', 'memory',
      '--rootDir', '/test-memory'
    ], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe']
    })

    let output = ''
    proc.stdout.on('data', (data) => {
      output += data.toString()
    })

    await new Promise(resolve => setTimeout(resolve, 2000))

    const initRequest = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'test-client',
          version: '1.0.0'
        }
      }
    })

    proc.stdin.write(initRequest + '\n')
    await new Promise(resolve => setTimeout(resolve, 1000))

    expect(output.length).toBeGreaterThan(0)

    proc.kill()
  }, 10000)

  it('should reject invalid backend type', async () => {
    const proc = spawn('node', [
      './bin/agentbe-server.js',
      '--backend', 'invalid',
      '--rootDir', '/tmp/test'
    ], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe']
    })

    let stderr = ''
    proc.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    await new Promise(resolve => setTimeout(resolve, 1000))

    expect(stderr).toContain('Unknown backend type')

    proc.kill()
  })

  it('should require rootDir argument', async () => {
    const proc = spawn('node', [
      './bin/agentbe-server.js',
      '--backend', 'local'
      // Missing --rootDir
    ], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe']
    })

    let stderr = ''
    proc.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    await new Promise(resolve => setTimeout(resolve, 1000))

    expect(stderr).toContain('rootDir')

    proc.kill()
  })
})
