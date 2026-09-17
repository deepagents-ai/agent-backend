import { describe, expect, it } from 'vitest'
import { DAEMON_SECRET_ENV_VARS, secretsEqual, stripDaemonSecretsFromEnv } from '../../../src/server/auth.js'

describe('secretsEqual', () => {
  it('matches identical secrets', () => {
    expect(secretsEqual('Bearer abc123', 'Bearer abc123')).toBe(true)
  })

  it.each([
    ['different content', 'Bearer abc124'],
    ['shorter', 'Bearer abc'],
    ['longer', 'Bearer abc1234'],
    ['empty', ''],
    ['case differs', 'bearer abc123'],
  ])('rejects %s', (_label, supplied) => {
    expect(secretsEqual(supplied, 'Bearer abc123')).toBe(false)
  })

  it('rejects a missing value', () => {
    expect(secretsEqual(undefined, 'x')).toBe(false)
    expect(secretsEqual(null, 'x')).toBe(false)
  })
})

describe('stripDaemonSecretsFromEnv', () => {
  it('removes the daemon credentials and leaves everything else', () => {
    const env: NodeJS.ProcessEnv = { AUTH_TOKEN: 'a', MCP_AUTH_TOKEN: 'b', PATH: '/usr/bin', OTHER_TOKEN: 'c' }
    stripDaemonSecretsFromEnv(env)
    expect(env).toEqual({ PATH: '/usr/bin', OTHER_TOKEN: 'c' })
    expect(DAEMON_SECRET_ENV_VARS).toEqual(['AUTH_TOKEN', 'MCP_AUTH_TOKEN'])
  })
})
