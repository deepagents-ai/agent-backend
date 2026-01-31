import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RemoteWorkspace } from '../src/workspace/RemoteWorkspace.js'
import type { RemoteBackend } from '../src/backends/RemoteBackend.js'
import { FileSystemError } from '../src/types.js'

describe('RemoteWorkspace', () => {
  let mockBackend: RemoteBackend
  let workspace: RemoteWorkspace

  beforeEach(() => {
    // Create mock backend with all required methods
    mockBackend = {
      type: 'remote',
      userId: 'test-user',
      options: {
        type: 'remote',
        userId: 'test-user',
        host: 'test-host',
        sshPort: 22,
        sshAuth: { type: 'password', credentials: { username: 'test', password: 'test' } },
        preventDangerous: true,
      },
      connected: true,
      execInWorkspace: vi.fn().mockResolvedValue('command output'),
      readFile: vi.fn().mockResolvedValue('file content'),
      writeFile: vi.fn().mockResolvedValue(undefined),
      createDirectory: vi.fn().mockResolvedValue(undefined),
      touchFile: vi.fn().mockResolvedValue(undefined),
      pathExists: vi.fn().mockResolvedValue(true),
      pathStat: vi.fn().mockResolvedValue({
        isFile: () => true,
        isDirectory: () => false,
        size: 1024,
        mtime: new Date(),
        atime: new Date(),
        birthtime: new Date(),
        mode: 0o644,
      }),
      listDirectory: vi.fn().mockResolvedValue(['file1.txt', 'file2.txt']),
      deleteDirectory: vi.fn().mockResolvedValue(undefined),
      getWorkspace: vi.fn(),
      listWorkspaces: vi.fn(),
      destroy: vi.fn(),
    } as unknown as RemoteBackend

    workspace = new RemoteWorkspace(
      mockBackend,
      'test-user',
      'test-workspace',
      '/tmp/constellation-fs/users/test-user/test-workspace'
    )
  })

  describe('properties', () => {
    it('should have correct workspaceName', () => {
      expect(workspace.workspaceName).toBe('test-workspace')
    })

    it('should have correct userId', () => {
      expect(workspace.userId).toBe('test-user')
    })

    it('should have correct workspacePath', () => {
      expect(workspace.workspacePath).toBe('/tmp/constellation-fs/users/test-user/test-workspace')
    })

    it('should reference the backend', () => {
      expect(workspace.backend).toBe(mockBackend)
    })
  })

  describe('exec', () => {
    it('should execute command via backend', async () => {
      const result = await workspace.exec('echo "hello"')

      expect(result).toBe('command output')
      expect(mockBackend.execInWorkspace).toHaveBeenCalledWith(
        workspace.workspacePath,
        'echo "hello"',
        'utf8',
        undefined
      )
    })

    it('should pass encoding option to backend', async () => {
      vi.mocked(mockBackend.execInWorkspace).mockResolvedValue(Buffer.from('binary'))

      const result = await workspace.exec('cat file.bin', { encoding: 'buffer' })

      expect(result).toBeInstanceOf(Buffer)
      expect(mockBackend.execInWorkspace).toHaveBeenCalledWith(
        workspace.workspacePath,
        'cat file.bin',
        'buffer',
        undefined
      )
    })

    it('should reject empty commands', async () => {
      await expect(workspace.exec('')).rejects.toThrow('Command cannot be empty')
      await expect(workspace.exec('   ')).rejects.toThrow('Command cannot be empty')
    })

    it('should pass custom environment variables', async () => {
      await workspace.exec('echo $MY_VAR', { env: { MY_VAR: 'test' } })

      expect(mockBackend.execInWorkspace).toHaveBeenCalledWith(
        workspace.workspacePath,
        'echo $MY_VAR',
        'utf8',
        { MY_VAR: 'test' }
      )
    })
  })

  describe('write', () => {
    it('should write file content via backend', async () => {
      await workspace.write('test.txt', 'file content')

      expect(mockBackend.writeFile).toHaveBeenCalledWith(
        '/tmp/constellation-fs/users/test-user/test-workspace/test.txt',
        'file content'
      )
    })

    it('should handle Buffer content', async () => {
      const buffer = Buffer.from('binary data')
      await workspace.write('binary.bin', buffer)

      expect(mockBackend.writeFile).toHaveBeenCalledWith(
        '/tmp/constellation-fs/users/test-user/test-workspace/binary.bin',
        buffer
      )
    })

    it('should validate path before writing', async () => {
      await expect(workspace.write('', 'content')).rejects.toThrow('Path cannot be empty')
    })
  })

  describe('mkdir', () => {
    it('should create directory via backend', async () => {
      await workspace.mkdir('new-dir')

      expect(mockBackend.createDirectory).toHaveBeenCalledWith(
        '/tmp/constellation-fs/users/test-user/test-workspace/new-dir',
        true // recursive by default
      )
    })

    it('should support non-recursive creation', async () => {
      await workspace.mkdir('single-dir', { recursive: false })

      expect(mockBackend.createDirectory).toHaveBeenCalledWith(
        '/tmp/constellation-fs/users/test-user/test-workspace/single-dir',
        false
      )
    })

    it('should create nested directories', async () => {
      await workspace.mkdir('path/to/nested/dir')

      expect(mockBackend.createDirectory).toHaveBeenCalledWith(
        '/tmp/constellation-fs/users/test-user/test-workspace/path/to/nested/dir',
        true
      )
    })
  })

  describe('touch', () => {
    it('should create empty file via backend', async () => {
      await workspace.touch('newfile.txt')

      expect(mockBackend.touchFile).toHaveBeenCalledWith(
        '/tmp/constellation-fs/users/test-user/test-workspace/newfile.txt'
      )
    })
  })

  describe('exists', () => {
    it('should check path existence via backend', async () => {
      const result = await workspace.exists('somefile.txt')

      expect(result).toBe(true)
      expect(mockBackend.pathExists).toHaveBeenCalledWith(
        '/tmp/constellation-fs/users/test-user/test-workspace/somefile.txt'
      )
    })

    it('should return false for non-existent paths', async () => {
      vi.mocked(mockBackend.pathExists).mockResolvedValue(false)

      const result = await workspace.exists('nonexistent.txt')

      expect(result).toBe(false)
    })
  })

  describe('stat', () => {
    it('should return file stats via backend', async () => {
      const stats = await workspace.stat('file.txt')

      expect(stats.size).toBe(1024)
      expect(stats.isFile()).toBe(true)
      expect(mockBackend.pathStat).toHaveBeenCalledWith(
        '/tmp/constellation-fs/users/test-user/test-workspace/file.txt'
      )
    })
  })

  describe('readdir', () => {
    it('should list directory contents via backend', async () => {
      const result = await workspace.readdir('.')

      expect(result).toEqual(['file1.txt', 'file2.txt'])
      expect(mockBackend.listDirectory).toHaveBeenCalledWith(
        '/tmp/constellation-fs/users/test-user/test-workspace'
      )
    })

    it('should throw when withFileTypes is requested', async () => {
      await expect(
        workspace.readdir('.', { withFileTypes: true })
      ).rejects.toThrow('withFileTypes option is not supported for remote workspaces')
    })
  })

  describe('readFile', () => {
    it('should read file content via backend', async () => {
      const content = await workspace.readFile('file.txt', 'utf-8')

      expect(content).toBe('file content')
      expect(mockBackend.readFile).toHaveBeenCalledWith(
        '/tmp/constellation-fs/users/test-user/test-workspace/file.txt',
        'utf-8'
      )
    })

    it('should read file as Buffer when no encoding', async () => {
      vi.mocked(mockBackend.readFile).mockResolvedValue(Buffer.from('binary'))

      const content = await workspace.readFile('file.bin')

      expect(content).toBeInstanceOf(Buffer)
    })
  })

  describe('writeFile', () => {
    it('should write file via backend', async () => {
      await workspace.writeFile('output.txt', 'content', 'utf-8')

      expect(mockBackend.writeFile).toHaveBeenCalledWith(
        '/tmp/constellation-fs/users/test-user/test-workspace/output.txt',
        'content',
        'utf-8'
      )
    })
  })

  describe('delete', () => {
    it('should delete workspace via backend', async () => {
      await workspace.delete()

      expect(mockBackend.deleteDirectory).toHaveBeenCalledWith(workspace.workspacePath)
    })
  })

  describe('list', () => {
    it('should list workspace contents', async () => {
      const result = await workspace.list()

      expect(result).toEqual(['file1.txt', 'file2.txt'])
      expect(mockBackend.listDirectory).toHaveBeenCalledWith(workspace.workspacePath)
    })
  })

  describe('path validation', () => {
    it('should reject empty paths', async () => {
      await expect(workspace.readFile('', 'utf-8')).rejects.toThrow('Path cannot be empty')
    })

    it('should handle workspace-relative paths starting with /', async () => {
      await workspace.exists('/relative-path.txt')

      // Path starting with / should be treated as workspace-relative
      expect(mockBackend.pathExists).toHaveBeenCalledWith(
        '/tmp/constellation-fs/users/test-user/test-workspace/relative-path.txt'
      )
    })
  })

  describe('synchronous methods', () => {
    it('should throw for existsSync', () => {
      expect(() => workspace.existsSync('file.txt')).toThrow(
        'Synchronous operations are not supported for remote workspaces'
      )
    })

    it('should throw for mkdirSync', () => {
      expect(() => workspace.mkdirSync('dir')).toThrow(
        'Synchronous operations are not supported for remote workspaces'
      )
    })

    it('should throw for readdirSync', () => {
      expect(() => workspace.readdirSync('.')).toThrow(
        'Synchronous operations are not supported for remote workspaces'
      )
    })

    it('should throw for readFileSync', () => {
      expect(() => workspace.readFileSync('file.txt')).toThrow(
        'Synchronous operations are not supported for remote workspaces'
      )
    })

    it('should throw for statSync', () => {
      expect(() => workspace.statSync('file.txt')).toThrow(
        'Synchronous operations are not supported for remote workspaces'
      )
    })

    it('should throw for writeFileSync', () => {
      expect(() => workspace.writeFileSync('file.txt', 'content')).toThrow(
        'Synchronous operations are not supported for remote workspaces'
      )
    })
  })

  describe('promises API', () => {
    it('should provide promises.readdir', async () => {
      const result = await workspace.promises.readdir('subdir')

      expect(result).toEqual(['file1.txt', 'file2.txt'])
    })

    it('should throw for promises.readdir with withFileTypes', async () => {
      await expect(
        workspace.promises.readdir('.', { withFileTypes: true })
      ).rejects.toThrow('withFileTypes option is not supported for remote workspaces')
    })
  })
})
