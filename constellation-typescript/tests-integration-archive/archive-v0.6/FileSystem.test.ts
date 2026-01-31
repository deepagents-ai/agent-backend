import { existsSync } from 'fs'
import { mkdir, rm } from 'fs/promises'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DangerousOperationError, FileSystem, LocalBackend } from '../src/index.js'
import { ConstellationFS } from '../src/config/Config.js'

describe('FileSystem', () => {
  const testWorkspace = join(process.cwd(), 'test-workspace')

  beforeEach(async () => {
    ConstellationFS.setConfig({ workspaceRoot: '/tmp/constellation-fs-test' })
    // Create test workspace
    if (!existsSync(testWorkspace)) {
      await mkdir(testWorkspace, { recursive: true })
    }
  })

  afterEach(async () => {
    // Clean up test workspace
    if (existsSync(testWorkspace)) {
      await rm(testWorkspace, { recursive: true, force: true })
    }
    ConstellationFS.reset()
  })

  describe('Basic Operations', () => {
    it('should create FileSystem with userId', () => {
      const fs = new FileSystem({ userId: 'test-user' })
      expect(fs.userId).toBe('test-user')
      expect(fs.config.preventDangerous).toBe(true)
    })

    it('should execute simple commands', async () => {
      const fs = new FileSystem({ userId: 'testuser' })
      const workspace = await fs.getWorkspace('default')
      const result = await workspace.exec('echo "hello world"')
      expect(result).toBe('hello world')
    })

    it('should read and write files', async () => {
      const fs = new FileSystem({ userId: 'testuser' })
      const workspace = await fs.getWorkspace('default')
      const testContent = 'Hello, ConstellationFS!'

      await workspace.write('test.txt', testContent)
      const content = await workspace.readFile('test.txt', 'utf-8')

      expect(content).toBe(testContent)
    })

    it('should list files', async () => {
      const fs = new FileSystem({ userId: 'testuser' })
      const workspace = await fs.getWorkspace('default')

      // Create some test files using the workspace API
      await workspace.write('file1.txt', 'content1')
      await workspace.write('file2.txt', 'content2')

      const result = await workspace.exec('ls')
      const files = result.split('\n').filter(Boolean)
      expect(files).toContain('file1.txt')
      expect(files).toContain('file2.txt')
    })
  })

  describe('Safety Features', () => {
    it('should block dangerous operations by default', async () => {
      const fs = new FileSystem({ userId: 'testuser' })
      const workspace = await fs.getWorkspace('default')

      await expect(workspace.exec('rm -rf /')).rejects.toThrow(DangerousOperationError)
    })

    it('should call onDangerousOperation callback when provided', async () => {
      let calledWith: string | undefined

      const fs = new FileSystem({
        userId: 'testuser',
        type: 'local',
        shell: 'bash',
        validateUtils: false,
        preventDangerous: true,
        onDangerousOperation: (command: string) => {
          calledWith = command
        }
      })

      const workspace = await fs.getWorkspace('default')
      const result = await workspace.exec('sudo something')
      expect(result).toBe('')
      expect(calledWith).toBe('sudo something')
    })
  })

  describe('Workspace Management', () => {
    it('should get workspace with custom name', async () => {
      const fs = new FileSystem({ userId: 'testuser' })
      const workspace = await fs.getWorkspace('custom-subdir')

      // Workspace should contain both userId and workspaceName
      expect(workspace.userId).toBe('testuser')
      expect(workspace.workspaceName).toBe('custom-subdir')
      expect(workspace.workspacePath).toContain('testuser')
      expect(workspace.workspacePath).toContain('custom-subdir')
    })

    it('should allow read/write operations in custom workspace', async () => {
      const fs = new FileSystem({ userId: 'testuser' })
      const workspace = await fs.getWorkspace('project-a')

      const testContent = 'Test content in custom workspace'
      await workspace.write('custom-test.txt', testContent)
      const content = await workspace.readFile('custom-test.txt', 'utf-8')

      expect(content).toBe(testContent)
    })

    it('should isolate workspaces with different names', async () => {
      const fs = new FileSystem({ userId: 'testuser' })
      const ws1 = await fs.getWorkspace('workspace-1')
      const ws2 = await fs.getWorkspace('workspace-2')

      // Write to first workspace
      await ws1.write('isolated-file.txt', 'Content in workspace 1')

      // Verify workspaces are different
      expect(ws1.workspacePath).not.toBe(ws2.workspacePath)

      // Second workspace should not have the file
      await expect(ws2.readFile('isolated-file.txt', 'utf-8')).rejects.toThrow()
    })

    it('should support nested directory paths in workspace name', async () => {
      const fs = new FileSystem({ userId: 'testuser' })
      const workspace = await fs.getWorkspace('projects/2024/my-app')

      expect(workspace.workspacePath).toContain('projects/2024/my-app')

      // Should be able to perform operations
      await workspace.write('nested-test.txt', 'Nested workspace test')
      const content = await workspace.readFile('nested-test.txt', 'utf-8')
      expect(content).toBe('Nested workspace test')
    })

    it('should work with default workspace', async () => {
      const fs = new FileSystem({ userId: 'testuser' })
      const workspace = await fs.getWorkspace('default')

      // Should use default workspace name
      expect(workspace.workspaceName).toBe('default')

      // Should still work normally
      await workspace.write('default-workspace.txt', 'Default workspace test')
      const content = await workspace.readFile('default-workspace.txt', 'utf-8')
      expect(content).toBe('Default workspace test')
    })

    it('should allow mkdir and touch in workspace', async () => {
      const fs = new FileSystem({ userId: 'testuser' })
      const workspace = await fs.getWorkspace('project-b')

      // Create directory structure
      await workspace.mkdir('src/utils')
      await workspace.touch('src/utils/helper.ts')

      // Verify directory and file exist
      const lsResult = await workspace.exec('find . -type f')
      expect(lsResult).toContain('src/utils/helper.ts')
    })

    it('should execute commands in the workspace directory', async () => {
      const fs = new FileSystem({ userId: 'testuser' })
      const workspace = await fs.getWorkspace('execution-test')

      // Get the current working directory from the command
      const pwd = await workspace.exec('pwd')

      // Should contain the workspace path
      expect(pwd).toContain('testuser')
      expect(pwd).toContain('execution-test')
    })

    it('should support custom environment variables via FileSystem API', async () => {
      const fs = new FileSystem({ userId: 'testuser' })
      const workspace = await fs.getWorkspace('env-workspace', {
        env: {
          MY_VAR: 'my-value',
          NODE_ENV: 'production',
        },
      })

      const result = await workspace.exec('echo "$MY_VAR $NODE_ENV"')
      expect(result).toBe('my-value production')
    })

    it('should isolate environment variables between workspaces', async () => {
      const fs = new FileSystem({ userId: 'testuser' })

      const ws1 = await fs.getWorkspace('ws-env-1', {
        env: { ENV_VAR: 'value1' },
      })

      const ws2 = await fs.getWorkspace('ws-env-2', {
        env: { ENV_VAR: 'value2' },
      })

      const result1 = await ws1.exec('echo $ENV_VAR')
      const result2 = await ws2.exec('echo $ENV_VAR')

      expect(result1).toBe('value1')
      expect(result2).toBe('value2')
    })

    it('should work without custom environment variables', async () => {
      const fs = new FileSystem({ userId: 'testuser' })
      const workspace = await fs.getWorkspace('no-env-workspace')

      const result = await workspace.exec('echo "test"')
      expect(result).toBe('test')
    })
  })

  describe('Backend Override', () => {
    it('should accept a custom backend instance', async () => {
      const customBackend = new LocalBackend({
        userId: 'custom-user',
        type: 'local',
        preventDangerous: true,
      })

      const fs = new FileSystem(customBackend)

      expect(fs.userId).toBe('custom-user')
      expect(fs.config.type).toBe('local')
      expect(fs.config.preventDangerous).toBe(true)

      await fs.destroy()
    })

    it('should use the provided backend for workspace operations', async () => {
      const customBackend = new LocalBackend({
        userId: 'backend-test-user',
        type: 'local',
        shell: 'bash',
        preventDangerous: true,
      })

      const fs = new FileSystem(customBackend)
      const workspace = await fs.getWorkspace('backend-workspace')

      await workspace.write('backend-test.txt', 'Testing backend override')
      const content = await workspace.readFile('backend-test.txt', 'utf-8')

      expect(content).toBe('Testing backend override')
      expect(workspace.userId).toBe('backend-test-user')

      await fs.destroy()
    })

    it('should share backend state across multiple FileSystem instances', async () => {
      const sharedBackend = new LocalBackend({
        userId: 'shared-user',
        type: 'local',
        preventDangerous: true,
      })

      const fs1 = new FileSystem(sharedBackend)
      const fs2 = new FileSystem(sharedBackend)

      const ws1 = await fs1.getWorkspace('workspace-1')
      const ws2 = await fs2.getWorkspace('workspace-2')

      await ws1.write('file1.txt', 'From FileSystem 1')
      await ws2.write('file2.txt', 'From FileSystem 2')

      const content1 = await ws1.readFile('file1.txt', 'utf-8')
      const content2 = await ws2.readFile('file2.txt', 'utf-8')

      expect(content1).toBe('From FileSystem 1')
      expect(content2).toBe('From FileSystem 2')

      // Both should reference the same backend
      expect(fs1.userId).toBe('shared-user')
      expect(fs2.userId).toBe('shared-user')

      await fs1.destroy()
      // Note: fs2.destroy() would error since backend is already destroyed
    })

    it('should support backend with custom onDangerousOperation callback', async () => {
      let dangerousCommandCalled = false
      let capturedCommand = ''

      const customBackend = new LocalBackend({
        userId: 'callback-user',
        type: 'local',
        preventDangerous: true,
        onDangerousOperation: (command: string) => {
          dangerousCommandCalled = true
          capturedCommand = command
        },
      })

      const fs = new FileSystem(customBackend)
      const workspace = await fs.getWorkspace('callback-test')

      await workspace.exec('sudo echo test')

      expect(dangerousCommandCalled).toBe(true)
      expect(capturedCommand).toBe('sudo echo test')

      await fs.destroy()
    })

    it('should maintain backend configuration through FileSystem', async () => {
      const customBackend = new LocalBackend({
        userId: 'config-user',
        type: 'local',
        shell: 'bash',
        validateUtils: false,
        preventDangerous: false,
        maxOutputLength: 1000,
      })

      const fs = new FileSystem(customBackend)

      expect(fs.config.type).toBe('local')
      expect(fs.config.shell).toBe('bash')
      expect(fs.config.validateUtils).toBe(false)
      expect(fs.config.preventDangerous).toBe(false)
      expect(fs.config.maxOutputLength).toBe(1000)

      await fs.destroy()
    })

    it('should still support config-based construction after adding backend override', async () => {
      // Ensure backward compatibility - config-based construction still works
      const fs = new FileSystem({
        userId: 'legacy-user',
        type: 'local',
        preventDangerous: true,
      })

      const workspace = await fs.getWorkspace('legacy-test')
      await workspace.write('legacy.txt', 'Legacy config works')
      const content = await workspace.readFile('legacy.txt', 'utf-8')

      expect(content).toBe('Legacy config works')
      expect(fs.userId).toBe('legacy-user')

      await fs.destroy()
    })

    it('should allow overriding filesystem operations in custom backend', async () => {
      // Create a custom backend that tracks filesystem calls
      const callLog: string[] = []

      class CustomLocalBackend extends LocalBackend {
        async readFileAsync(path: string, encoding: 'utf-8'): Promise<string> {
          callLog.push(`readFileAsync: ${path}`)
          return await super.readFileAsync(path, encoding)
        }

        async writeFileAsync(path: string, content: string, encoding: 'utf-8'): Promise<void>
        async writeFileAsync(path: string, content: string, options: { flag: string }): Promise<void>
        async writeFileAsync(path: string, content: string, encodingOrOptions: 'utf-8' | { flag: string }): Promise<void> {
          callLog.push(`writeFileAsync: ${path}`)
          await super.writeFileAsync(path, content, encodingOrOptions as any)
        }

        async mkdirAsync(path: string, options: { recursive?: boolean }): Promise<void> {
          callLog.push(`mkdirAsync: ${path}`)
          await super.mkdirAsync(path, options)
        }
      }

      const customBackend = new CustomLocalBackend({
        userId: 'custom-fs-user',
        type: 'local',
        preventDangerous: true,
      })

      const fs = new FileSystem(customBackend)
      const workspace = await fs.getWorkspace('custom-fs-test')

      // Perform operations
      await workspace.write('test.txt', 'Custom backend test')
      const content = await workspace.readFile('test.txt', 'utf-8')

      // Verify operations were tracked
      expect(callLog.some((log) => log.includes('writeFileAsync') && log.includes('test.txt'))).toBe(true)
      expect(callLog.some((log) => log.includes('readFileAsync') && log.includes('test.txt'))).toBe(true)
      expect(content).toBe('Custom backend test')

      // Verify that our custom backend methods were actually called
      expect(callLog.length).toBeGreaterThan(0)

      await fs.destroy()
    })
  })
})