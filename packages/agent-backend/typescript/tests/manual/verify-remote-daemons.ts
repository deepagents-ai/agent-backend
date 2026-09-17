/**
 * Verify RemoteFilesystemBackend against real daemons behind a TLS proxy that routes on a header
 * (e.g. Fly's fly-force-instance-id). Not part of any test suite: run by hand.
 *
 *   AGENTBE_VERIFY_HOST=my-app.fly.dev \
 *   AGENTBE_VERIFY_TARGETS='[{"name":"a","authToken":"...","headers":{"fly-force-instance-id":"..."}}, ...]' \
 *   npx tsx tests/manual/verify-remote-daemons.ts
 *
 * Optional: AGENTBE_VERIFY_PORT (default 443), AGENTBE_VERIFY_ROOT (default /var/workspace).
 */

import { VercelAIAdapter } from '../../src/adapters/VercelAIAdapter.js'
import { RemoteFilesystemBackend } from '../../src/backends/RemoteFilesystemBackend.js'
import { BackendError } from '../../src/types.js'

interface Target {
  name: string
  authToken: string
  headers: Record<string, string>
}

const host = requireEnv('AGENTBE_VERIFY_HOST')
const targets = JSON.parse(requireEnv('AGENTBE_VERIFY_TARGETS')) as Target[]
const port = Number(process.env.AGENTBE_VERIFY_PORT ?? 443)
const rootDir = process.env.AGENTBE_VERIFY_ROOT ?? '/var/workspace'
const scopePath = `verify-${Date.now()}`

let failures = 0
const backends: RemoteFilesystemBackend[] = []

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    console.error(`${name} is required`)
    process.exit(2)
  }
  return value
}

function connect(target: Target, authToken = target.authToken): RemoteFilesystemBackend {
  const backend = new RemoteFilesystemBackend({
    rootDir,
    host,
    port,
    secure: true,
    authToken,
    headers: target.headers,
    reconnection: { enabled: false },
  })
  backends.push(backend)
  return backend
}

async function check(label: string, fn: () => Promise<string | void>): Promise<void> {
  const started = Date.now()
  try {
    const detail = await fn()
    console.log(`  ✓ ${label} (${Date.now() - started}ms)${detail ? ` — ${detail}` : ''}`)
  } catch (error) {
    failures++
    console.log(`  ✗ ${label}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function expectRejection(promise: Promise<unknown>, pattern: RegExp): Promise<string> {
  const error = await promise.then(() => null, (e: unknown) => e)
  assert(error instanceof Error, 'expected a rejection, but it succeeded')
  assert(pattern.test(error.message), `unexpected error: ${error.message}`)
  return error.message.slice(0, 120)
}

async function verifyTarget(target: Target): Promise<void> {
  console.log(`\n[${target.name}] ${JSON.stringify(target.headers)}`)
  const backend = connect(target)
  const scoped = backend.scope(scopePath)
  const marker = `${target.name}.txt`

  await check('exec reaches the expected machine', async () => {
    const out = (await backend.exec('echo "${FLY_MACHINE_ID:-$(hostname)}"')).toString().trim()
    return `machine ${out}`
  })

  await check('write, read, stat, readdir on a scoped backend', async () => {
    await scoped.write(`dir/${marker}`, `written via ${target.name}`)
    assert((await scoped.read(`dir/${marker}`)) === `written via ${target.name}`, 'read returned different content')
    assert((await scoped.stat(`dir/${marker}`)).isFile(), 'stat did not report a file')
    const entries = await scoped.readdir('dir')
    assert(entries.includes(marker), `readdir missing ${marker}: ${entries.join(', ')}`)
  })

  await check('exec runs in the scope', async () => {
    const out = (await scoped.exec(`cat dir/${marker}`)).toString().trim()
    assert(out === `written via ${target.name}`, `got ${JSON.stringify(out)}`)
  })

  await check('commands cannot see the auth token', async () => {
    const env = (await backend.exec('env')).toString()
    assert(!env.includes(target.authToken), 'token value present in env output')
    assert(!/^(MCP_)?AUTH_TOKEN=/m.test(env), 'AUTH_TOKEN variable present in env output')
  })

  await check('VercelAIAdapter lists MCP tools on the scope', async () => {
    const client = await new VercelAIAdapter(scoped).getMCPClient()
    const names = Object.keys(await client.tools())
    assert(names.includes('list_directory'), `tools: ${names.join(', ')}`)
    return `${names.length} tools`
  })

  await check('scoped getMCPClient list_directory shows only the scope', async () => {
    await backend.write(`outside-${scopePath}.txt`, 'root level')
    const client = await scoped.getMCPClient()
    const result = await client.callTool({ name: 'list_directory', arguments: { path: '.' } })
    const text = (result.content as Array<{ text: string }>).map((c) => c.text).join('\n')
    assert(text.includes('[DIR] dir'), `listing: ${text}`)
    assert(!text.includes('outside-'), `listing leaked root entries: ${text}`)
    await backend.rm(`outside-${scopePath}.txt`)
  })

  await check('wrong token is refused on SSH-WS', async () => {
    const wrong = connect(target, `${target.authToken}-wrong`)
    const message = await expectRejection(wrong.exec('true'), /auth/i)
    const error = await wrong.exec('true').catch((e: unknown) => e)
    assert(error instanceof BackendError && error.code === 'AUTH_FAILED', 'expected AUTH_FAILED')
    return message
  })

  await check('wrong token is refused on MCP', async () => {
    const wrong = connect(target, `${target.authToken}-wrong`)
    return expectRejection(new VercelAIAdapter(wrong).getMCPClient(), /401/)
  })
}

async function main(): Promise<void> {
  console.log(`Verifying ${targets.length} daemon(s) at https://${host}:${port}, scope ${scopePath}`)
  for (const target of targets) {
    await verifyTarget(target)
  }

  if (targets.length > 1) {
    console.log('\n[isolation]')
    for (const writer of targets) {
      for (const reader of targets.filter((t) => t !== writer)) {
        await check(`${writer.name}'s file is absent through ${reader.name}`, async () => {
          const scoped = connect(reader).scope(scopePath)
          assert(!(await scoped.exists(`dir/${writer.name}.txt`)), 'file is visible')
        })
      }
    }
  }

  console.log('\n[cleanup]')
  for (const target of targets) {
    await check(`remove ${scopePath} on ${target.name}`, async () => {
      await connect(target).rm(scopePath, { recursive: true })
    })
  }

  await Promise.all(backends.map((b) => b.destroy().catch(() => {})))
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
  process.exit(failures ? 1 : 0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
