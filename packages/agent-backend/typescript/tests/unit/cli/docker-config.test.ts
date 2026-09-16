import { describe, expect, it } from 'vitest'
import {
  buildDockerRunArgs,
  DEFAULT_DAEMON_IMAGE,
  envFileSetsAuthToken,
  hasRegistryHost,
  isMissingPlatformError,
  LOCAL_DAEMON_IMAGE,
  parseStartDockerArgs,
  resolveImage,
  type StartDockerConfig,
} from '../../../src/cli/docker-config.js'

function parse(args: string[], env: Record<string, string | undefined> = {}): StartDockerConfig {
  const result = parseStartDockerArgs(args, env)
  expect(result.error).toBeUndefined()
  return result.config!
}

describe('start-docker config', () => {
  describe('parseStartDockerArgs', () => {
    it('uses defaults with no arguments', () => {
      expect(parse([])).toEqual({
        port: 3001,
        bind: '127.0.0.1',
        build: false,
        dev: false,
        foreground: false,
      })
    })

    it('parses every flag', () => {
      const config = parse([
        '--port', '8080',
        '--bind', '0.0.0.0',
        '--auth-token', 'tok',
        '--workspace', './ws',
        '--env-file', '.env',
        '--image', 'my/image:1',
        '--foreground',
      ])
      expect(config).toEqual({
        port: 8080,
        bind: '0.0.0.0',
        authToken: 'tok',
        workspace: './ws',
        envFile: '.env',
        image: 'my/image:1',
        build: false,
        dev: false,
        foreground: true,
      })
    })

    it('parses --build and --dev together', () => {
      const config = parse(['--build', '--dev'])
      expect(config.build).toBe(true)
      expect(config.dev).toBe(true)
    })

    it.each(['1023', '65536', '99', 'abc', '3001.5'])('rejects port %s', (port) => {
      expect(parseStartDockerArgs(['--port', port]).error).toBe(
        '--port must be an integer between 1024 and 65535'
      )
    })

    it.each(['1024', '65535'])('accepts boundary port %s', (port) => {
      expect(parse(['--port', port]).port).toBe(Number(port))
    })

    it.each(['--port', '--bind', '--auth-token', '--workspace', '--env-file', '--image'])(
      'rejects %s without a value',
      (flag) => {
        expect(parseStartDockerArgs([flag]).error).toBe(`${flag} requires a value`)
        expect(parseStartDockerArgs([flag, '--foreground']).error).toBe(`${flag} requires a value`)
      }
    )

    it('rejects unknown flags', () => {
      expect(parseStartDockerArgs(['--nope']).error).toBe('Unknown option: --nope')
    })

    it('rejects positional arguments', () => {
      expect(parseStartDockerArgs(['extra']).error).toBe('Unexpected argument: extra')
    })

    it.each([['--build'], ['--dev']])('rejects --image combined with %s', (flag) => {
      expect(parseStartDockerArgs(['--image', 'x', flag]).error).toBe(
        '--image cannot be combined with --build or --dev'
      )
    })

    it('falls back to AUTH_TOKEN from the launcher environment', () => {
      expect(parse([], { AUTH_TOKEN: 'from-env' }).authToken).toBe('from-env')
    })

    it('prefers --auth-token over the environment', () => {
      expect(parse(['--auth-token', 'flag'], { AUTH_TOKEN: 'from-env' }).authToken).toBe('flag')
    })

    it('ignores an empty AUTH_TOKEN in the environment', () => {
      expect(parse([], { AUTH_TOKEN: '' }).authToken).toBeUndefined()
    })
  })

  describe('resolveImage', () => {
    it('defaults to the published image', () => {
      expect(resolveImage(parse([]))).toBe(DEFAULT_DAEMON_IMAGE)
    })

    it('uses --image when given', () => {
      expect(resolveImage(parse(['--image', 'my/image:1']))).toBe('my/image:1')
    })

    it.each([['--build'], ['--dev']])('uses the local image with %s', (flag) => {
      expect(resolveImage(parse([flag]))).toBe(LOCAL_DAEMON_IMAGE)
    })
  })

  describe('buildDockerRunArgs', () => {
    it('builds a detached run on loopback with no SSH port by default', () => {
      expect(buildDockerRunArgs(parse([]))).toEqual([
        'run', '--name', 'agentbe-daemon', '-d',
        '-p', '127.0.0.1:3001:3001',
        '-e', 'PORT=3001',
        DEFAULT_DAEMON_IMAGE,
      ])
    })

    it('never publishes the conventional SSH port', () => {
      const args = buildDockerRunArgs(parse(['--port', '8080', '--bind', '0.0.0.0']))
      expect(args.filter((a) => a.includes(':22'))).toEqual([])
      expect(args).toContain('0.0.0.0:8080:8080')
      expect(args).toContain('PORT=8080')
    })

    it('uses --rm instead of -d in the foreground', () => {
      const args = buildDockerRunArgs(parse(['--foreground']))
      expect(args).toContain('--rm')
      expect(args).not.toContain('-d')
    })

    it('passes the auth token and workspace mount', () => {
      const args = buildDockerRunArgs(parse(['--auth-token', 'tok', '--workspace', '/abs/ws']))
      expect(args).toContain('AUTH_TOKEN=tok')
      expect(args).toContain('/abs/ws:/var/workspace')
    })

    it('places --env-file before explicit -e values so they take precedence', () => {
      const args = buildDockerRunArgs(parse(['--env-file', '/abs/.env', '--auth-token', 'tok']))
      const envFileIdx = args.indexOf('--env-file')
      expect(envFileIdx).toBeGreaterThan(-1)
      expect(envFileIdx).toBeLessThan(args.indexOf('PORT=3001'))
      expect(envFileIdx).toBeLessThan(args.indexOf('AUTH_TOKEN=tok'))
    })

    it('adds read-only source mounts and hot reload for --dev', () => {
      const args = buildDockerRunArgs(parse(['--dev']), { deployDir: '/repo/tmp/deploy', srcDir: '/repo/src' })
      expect(args).toContain('/repo/tmp/deploy:/app/agent-backend:ro')
      expect(args).toContain('/repo/src:/app/agent-backend/src:ro')
      expect(args).toContain('USE_LOCAL_BUILD=1')
      expect(args[args.length - 1]).toBe(LOCAL_DAEMON_IMAGE)
    })

    it('requires dev mounts when --dev is set', () => {
      expect(() => buildDockerRunArgs(parse(['--dev']))).toThrow('dev mounts are required')
    })

    it('forces a platform when given', () => {
      const args = buildDockerRunArgs(parse([]), undefined, 'linux/amd64')
      expect(args.slice(0, 6)).toEqual(['run', '--name', 'agentbe-daemon', '-d', '--platform', 'linux/amd64'])
    })

    it('always ends with the image', () => {
      const args = buildDockerRunArgs(parse(['--image', 'my/image:1', '--workspace', '/w']))
      expect(args[args.length - 1]).toBe('my/image:1')
    })
  })

  describe('envFileSetsAuthToken', () => {
    it('detects a set token', () => {
      expect(envFileSetsAuthToken('PORT=3001\nAUTH_TOKEN=secret\n')).toBe(true)
    })

    it('ignores commented and empty tokens', () => {
      expect(envFileSetsAuthToken('# AUTH_TOKEN=your-secret-token\nAUTH_TOKEN=\n')).toBe(false)
    })
  })

  describe('isMissingPlatformError', () => {
    it('detects a missing-architecture pull failure', () => {
      expect(isMissingPlatformError('no matching manifest for linux/arm64/v8 in the manifest list entries')).toBe(true)
    })

    it('ignores other pull failures', () => {
      expect(isMissingPlatformError('dial tcp: lookup ghcr.io: no such host')).toBe(false)
    })
  })

  describe('hasRegistryHost', () => {
    it.each([
      'ghcr.io/aspects-ai/agentbe-daemon:latest',
      'localhost:5000/agentbe-daemon',
      'localhost/agentbe-daemon',
      'registry.example.com:8443/team/image:1',
    ])('detects a registry host in %s', (image) => {
      expect(hasRegistryHost(image)).toBe(true)
    })

    it.each(['agentbe-daemon:latest', 'agentbe-daemon', 'team/image:1'])(
      'finds no registry host in %s',
      (image) => {
        expect(hasRegistryHost(image)).toBe(false)
      }
    )
  })
})
