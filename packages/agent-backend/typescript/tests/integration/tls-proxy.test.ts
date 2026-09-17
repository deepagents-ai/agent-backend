/**
 * RemoteFilesystemBackend through a TLS-terminating reverse proxy that routes on a header.
 *
 * Needs the proxy and daemon started by tests/integration/tls-proxy/run.sh, which also
 * trusts the proxy's local CA via NODE_EXTRA_CA_CERTS. Skipped otherwise.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { VercelAIAdapter } from '../../src/adapters/VercelAIAdapter.js'
import { RemoteFilesystemBackend } from '../../src/backends/RemoteFilesystemBackend.js'

const port = Number(process.env.AGENTBE_TLS_PROXY_PORT)
const authToken = process.env.AGENTBE_TLS_PROXY_TOKEN
const rootDir = process.env.AGENTBE_TLS_PROXY_ROOT

describe.skipIf(!port || !authToken || !rootDir)('RemoteFilesystemBackend via TLS proxy', () => {
  const backends: RemoteFilesystemBackend[] = []

  function connect(headers?: Record<string, string>): RemoteFilesystemBackend {
    const backend = new RemoteFilesystemBackend({
      rootDir: rootDir!,
      host: 'localhost',
      port,
      secure: true,
      authToken,
      headers,
      reconnection: { enabled: false },
    })
    backends.push(backend)
    return backend
  }

  afterEach(async () => {
    await Promise.all(backends.splice(0).map((b) => b.destroy()))
  })

  it('reads, writes, stats, lists and execs on a scoped backend', async () => {
    const scoped = connect({ 'x-route': 'a' }).scope('tenant-a')

    await scoped.write('notes/hello.txt', 'hello over tls')
    expect(await scoped.read('notes/hello.txt')).toBe('hello over tls')
    expect((await scoped.stat('notes/hello.txt')).isFile()).toBe(true)
    expect(await scoped.readdir('notes')).toEqual(['hello.txt'])
    expect((await scoped.exec('cat notes/hello.txt')).toString().trim()).toBe('hello over tls')
  })

  it('does not expose the daemon auth token to commands', async () => {
    const output = (await connect({ 'x-route': 'a' }).exec('env')).toString()
    expect(output).toContain('PATH=')
    expect(output).not.toContain(authToken!)
    expect(output).not.toMatch(/^(MCP_)?AUTH_TOKEN=/m)
  })

  it('lists MCP tools rooted at the scope through the adapter and getMCPClient', async () => {
    const backend = connect({ 'x-route': 'a' })
    await backend.write('outside.txt', 'root level')
    const scoped = backend.scope('tenant-b')
    await scoped.write('inside.txt', 'scoped')

    const adapterClient = await new VercelAIAdapter(scoped).getMCPClient()
    const tools = await adapterClient.tools()
    expect(Object.keys(tools)).toContain('list_directory')

    const client = await scoped.getMCPClient()
    const result = await client.callTool({ name: 'list_directory', arguments: { path: '.' } })
    const text = (result.content as Array<{ type: string; text: string }>).map((c) => c.text).join('\n')
    expect(text).toContain('inside.txt')
    expect(text).not.toContain('outside.txt')
  })

  it('fails with a connection error, not a timeout, when the routing header is missing', async () => {
    const backend = connect()

    const sshError = await backend.exec('true').then(() => null, (e: Error) => e)
    expect(sshError?.message).toContain('wss://localhost')
    expect(sshError?.message).toContain('404')
    expect(sshError?.message).not.toMatch(/timed? ?out/i)

    const mcpError = await new VercelAIAdapter(backend).getMCPClient().then(() => null, (e: Error) => e)
    expect(mcpError).toBeInstanceOf(Error)
    expect(mcpError?.message).toContain('https://localhost')
    expect(mcpError?.message).toContain('404')
    expect(mcpError?.message).not.toMatch(/timed? ?out/i)
  })
})
