import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LocalBackend } from '../src/backends/LocalBackend.js'
import { FileSystemError } from '../src/types.js'
import { ConstellationFS } from '../src/config/Config.js'

describe('Custom Environment Variables', () => {
  let backend: LocalBackend
  const testUserId = 'test-custom-env-user'

  beforeEach(() => {
    ConstellationFS.setConfig({ workspaceRoot: '/tmp/constellation-fs-test' })
    backend = new LocalBackend({
      userId: testUserId,
      type: 'local',
      shell: 'bash',
      validateUtils: false,
      preventDangerous: true,
    })
  })

  afterEach(async () => {
    await backend.destroy()
    ConstellationFS.reset()
  })

  describe('workspace configuration', () => {
    it('should create workspace with custom environment variables', async () => {
      const workspace = await backend.getWorkspace('env-test', {
        env: {
          NODE_ENV: 'development',
          API_KEY: 'test-key-123',
        },
      })

      expect(workspace).toBeDefined()
      expect(workspace.customEnv).toEqual({
        NODE_ENV: 'development',
        API_KEY: 'test-key-123',
      })
    })

    it('should create workspace without env config', async () => {
      const workspace = await backend.getWorkspace('no-env')

      expect(workspace).toBeDefined()
      expect(workspace.customEnv).toBeUndefined()
    })

    it('should handle empty env object', async () => {
      const workspace = await backend.getWorkspace('empty-env', {
        env: {},
      })

      expect(workspace).toBeDefined()
      expect(workspace.customEnv).toEqual({})
    })
  })

  describe('environment variable accessibility', () => {
    it('should make custom env vars available in exec commands', async () => {
      const workspace = await backend.getWorkspace('accessible-env', {
        env: {
          TEST_VAR: 'test-value',
          ANOTHER_VAR: 'another-value',
        },
      })

      const result = await workspace.exec('echo $TEST_VAR')
      expect(result).toBe('test-value')
    })

    it('should persist env vars across multiple exec calls', async () => {
      const workspace = await backend.getWorkspace('persistent-env', {
        env: {
          PERSIST_TEST: 'persisted',
        },
      })

      const result1 = await workspace.exec('echo $PERSIST_TEST')
      expect(result1).toBe('persisted')

      const result2 = await workspace.exec('echo $PERSIST_TEST')
      expect(result2).toBe('persisted')
    })

    it('should support multiple custom env vars in single command', async () => {
      const workspace = await backend.getWorkspace('multi-env', {
        env: {
          VAR1: 'value1',
          VAR2: 'value2',
          VAR3: 'value3',
        },
      })

      const result = await workspace.exec('echo "$VAR1 $VAR2 $VAR3"')
      expect(result).toBe('value1 value2 value3')
    })

    it('should use env vars in shell scripts', async () => {
      const workspace = await backend.getWorkspace('script-env', {
        env: {
          SCRIPT_VAR: 'script-value',
        },
      })

      await workspace.write(
        'test.sh',
        '#!/bin/bash\necho "Value is: $SCRIPT_VAR"'
      )
      await workspace.exec('chmod +x test.sh')

      const result = await workspace.exec('./test.sh')
      expect(result).toBe('Value is: script-value')
    })
  })

  describe('workspace isolation', () => {
    it('should isolate env vars between different workspaces', async () => {
      const ws1 = await backend.getWorkspace('isolated-1', {
        env: { ENV_VAR: 'workspace1' },
      })

      const ws2 = await backend.getWorkspace('isolated-2', {
        env: { ENV_VAR: 'workspace2' },
      })

      const result1 = await ws1.exec('echo $ENV_VAR')
      const result2 = await ws2.exec('echo $ENV_VAR')

      expect(result1).toBe('workspace1')
      expect(result2).toBe('workspace2')
    })

    it('should not leak env vars to workspaces without custom env', async () => {
      const wsWithEnv = await backend.getWorkspace('with-env', {
        env: { CUSTOM_ONLY: 'present' },
      })

      const wsWithoutEnv = await backend.getWorkspace('without-env')

      const result1 = await wsWithEnv.exec('echo $CUSTOM_ONLY')
      expect(result1).toBe('present')

      // Without custom env, the var should not be set
      const result2 = await wsWithoutEnv.exec('echo "${CUSTOM_ONLY:-not-set}"')
      expect(result2).toBe('not-set')
    })

    it('should treat same workspace name with different env as different instances', async () => {
      const ws1 = await backend.getWorkspace('same-name', {
        env: { CONFIG: 'v1' },
      })

      const ws2 = await backend.getWorkspace('same-name', {
        env: { CONFIG: 'v2' },
      })

      // These should be different instances due to different env configs
      expect(ws1).not.toBe(ws2)

      const result1 = await ws1.exec('echo $CONFIG')
      const result2 = await ws2.exec('echo $CONFIG')

      expect(result1).toBe('v1')
      expect(result2).toBe('v2')
    })
  })

  describe('security validation', () => {
    it('should block dangerous environment variables', async () => {
      const workspace = await backend.getWorkspace('blocked-env', {
        env: {
          LD_PRELOAD: '/malicious/lib.so',
          SAFE_VAR: 'safe-value',
        },
      })

      // LD_PRELOAD should be blocked
      const ldPreloadResult = await workspace.exec('echo "${LD_PRELOAD:-not-set}"')
      expect(ldPreloadResult).toBe('not-set')

      // Safe var should work
      const safeResult = await workspace.exec('echo $SAFE_VAR')
      expect(safeResult).toBe('safe-value')
    })

    it('should block LD_LIBRARY_PATH', async () => {
      const workspace = await backend.getWorkspace('block-ld-lib', {
        env: {
          LD_LIBRARY_PATH: '/malicious/libs',
        },
      })

      const result = await workspace.exec('echo "${LD_LIBRARY_PATH:-not-set}"')
      expect(result).toBe('not-set')
    })

    it('should block DYLD_INSERT_LIBRARIES', async () => {
      const workspace = await backend.getWorkspace('block-dyld-insert', {
        env: {
          DYLD_INSERT_LIBRARIES: '/malicious/lib.dylib',
        },
      })

      const result = await workspace.exec('echo "${DYLD_INSERT_LIBRARIES:-not-set}"')
      expect(result).toBe('not-set')
    })

    it('should block DYLD_LIBRARY_PATH', async () => {
      const workspace = await backend.getWorkspace('block-dyld-path', {
        env: {
          DYLD_LIBRARY_PATH: '/malicious/libs',
        },
      })

      const result = await workspace.exec('echo "${DYLD_LIBRARY_PATH:-not-set}"')
      expect(result).toBe('not-set')
    })

    it('should block IFS', async () => {
      const workspace = await backend.getWorkspace('block-ifs', {
        env: {
          IFS: '$(malicious command)',
        },
      })

      // IFS should be blocked, but we can't easily test its value
      // Just verify workspace still works
      const result = await workspace.exec('echo "test"')
      expect(result).toBe('test')
    })

    it('should block BASH_ENV', async () => {
      const workspace = await backend.getWorkspace('block-bash-env', {
        env: {
          BASH_ENV: '/malicious/script.sh',
        },
      })

      const result = await workspace.exec('echo "${BASH_ENV:-not-set}"')
      expect(result).toBe('not-set')
    })

    it('should block ENV', async () => {
      const workspace = await backend.getWorkspace('block-env', {
        env: {
          ENV: '/malicious/script.sh',
        },
      })

      const result = await workspace.exec('echo "${ENV:-not-set}"')
      expect(result).toBe('not-set')
    })

    it('should reject values with null bytes', async () => {
      // The validation happens during exec, not during workspace creation
      const workspace = await backend.getWorkspace('null-byte-test', {
        env: {
          BAD_VAR: 'value\0with-null',
        },
      })

      // The validation happens when we try to use the env vars
      await expect(
        workspace.exec('echo test')
      ).rejects.toThrow(FileSystemError)
    })

    it('should allow overriding protected variables with warning', async () => {
      // Protected vars like PATH are allowed but logged
      const workspace = await backend.getWorkspace('override-path', {
        env: {
          PATH: '/usr/bin:/bin', // Use valid paths that exist
        },
      })

      const result = await workspace.exec('echo $PATH')
      expect(result).toBe('/usr/bin:/bin')
    })
  })

  describe('special characters and values', () => {
    it('should handle env vars with spaces', async () => {
      const workspace = await backend.getWorkspace('spaces-test', {
        env: {
          SPACED_VAR: 'value with spaces',
        },
      })

      const result = await workspace.exec('echo "$SPACED_VAR"')
      expect(result).toBe('value with spaces')
    })

    it('should handle env vars with special shell characters', async () => {
      const workspace = await backend.getWorkspace('special-chars', {
        env: {
          SPECIAL: 'value-with-dashes_and_underscores.and.dots',
        },
      })

      const result = await workspace.exec('echo $SPECIAL')
      expect(result).toBe('value-with-dashes_and_underscores.and.dots')
    })

    it('should handle empty string values', async () => {
      const workspace = await backend.getWorkspace('empty-value', {
        env: {
          EMPTY_VAR: '',
        },
      })

      const result = await workspace.exec('echo "X${EMPTY_VAR}Y"')
      expect(result).toBe('XY')
    })

    it('should handle numeric values', async () => {
      const workspace = await backend.getWorkspace('numeric-test', {
        env: {
          PORT: '3000',
          MAX_CONNECTIONS: '100',
        },
      })

      const result = await workspace.exec('echo $PORT $MAX_CONNECTIONS')
      expect(result).toBe('3000 100')
    })

    it('should handle URL values', async () => {
      const workspace = await backend.getWorkspace('url-test', {
        env: {
          DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
          API_ENDPOINT: 'https://api.example.com/v1',
        },
      })

      const result = await workspace.exec('echo $DATABASE_URL')
      expect(result).toBe('postgres://user:pass@localhost:5432/db')
    })
  })

  describe('environment merging', () => {
    it('should preserve safe default environment variables', async () => {
      const workspace = await backend.getWorkspace('defaults-test', {
        env: {
          CUSTOM: 'value',
        },
      })

      // PWD should be set to workspace path
      const pwd = await workspace.exec('pwd')
      expect(pwd).toBe(workspace.workspacePath)

      // TMPDIR should contain workspace path
      const tmpdir = await workspace.exec('echo $TMPDIR')
      expect(tmpdir).toContain(workspace.workspacePath)
    })

    it('should have safe PATH by default', async () => {
      const workspace = await backend.getWorkspace('path-test')

      const path = await workspace.exec('echo $PATH')
      expect(path).toContain('/usr/bin')
      expect(path).toContain('/bin')
    })

    it('should set TMPDIR to workspace .tmp directory', async () => {
      const workspace = await backend.getWorkspace('tmpdir-test', {
        env: {
          CUSTOM: 'value',
        },
      })

      const tmpdir = await workspace.exec('echo $TMPDIR')
      expect(tmpdir).toContain(workspace.workspacePath)
      expect(tmpdir).toContain('.tmp')
    })

    it('should set locale to C for consistency', async () => {
      const workspace = await backend.getWorkspace('locale-test')

      const lang = await workspace.exec('echo $LANG')
      expect(lang).toBe('C')

      const lcAll = await workspace.exec('echo $LC_ALL')
      expect(lcAll).toBe('C')
    })
  })

  describe('real-world use cases', () => {
    it('should support Node.js environment configuration', async () => {
      const workspace = await backend.getWorkspace('node-env', {
        env: {
          NODE_ENV: 'production',
          NODE_OPTIONS: '--max-old-space-size=4096',
        },
      })

      const result = await workspace.exec('echo "$NODE_ENV $NODE_OPTIONS"')
      expect(result).toBe('production --max-old-space-size=4096')
    })

    it('should support database configuration', async () => {
      const workspace = await backend.getWorkspace('db-config', {
        env: {
          DB_HOST: 'localhost',
          DB_PORT: '5432',
          DB_NAME: 'testdb',
          DB_USER: 'testuser',
        },
      })

      const result = await workspace.exec(
        'echo "$DB_HOST:$DB_PORT/$DB_NAME ($DB_USER)"'
      )
      expect(result).toBe('localhost:5432/testdb (testuser)')
    })

    it('should support API key management', async () => {
      const workspace = await backend.getWorkspace('api-keys', {
        env: {
          OPENAI_API_KEY: 'sk-test-key',
          STRIPE_API_KEY: 'pk_test_key',
        },
      })

      const result = await workspace.exec('echo "${OPENAI_API_KEY:0:7}"')
      expect(result).toBe('sk-test')
    })

    it('should support debug flags', async () => {
      const workspace = await backend.getWorkspace('debug-flags', {
        env: {
          DEBUG: 'app:*',
          VERBOSE: 'true',
          LOG_LEVEL: 'debug',
        },
      })

      const result = await workspace.exec('echo "$DEBUG $VERBOSE $LOG_LEVEL"')
      expect(result).toBe('app:* true debug')
    })
  })

  describe('workspace caching', () => {
    it('should cache workspace with specific env config', async () => {
      const ws1 = await backend.getWorkspace('cached', {
        env: { VAR: 'value1' },
      })

      const ws2 = await backend.getWorkspace('cached', {
        env: { VAR: 'value1' },
      })

      // Same env config should return cached instance
      expect(ws1).toBe(ws2)
    })

    it('should not cache workspace with different env config', async () => {
      const ws1 = await backend.getWorkspace('different-cache', {
        env: { VAR: 'value1' },
      })

      const ws2 = await backend.getWorkspace('different-cache', {
        env: { VAR: 'value2' },
      })

      // Different env config should create new instance
      expect(ws1).not.toBe(ws2)
    })
  })
})
