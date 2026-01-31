import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { LocalBackend } from '../src/backends/LocalBackend.js'
import { FileSystemError } from '../src/types.js'
import type { LocalWorkspace } from '../src/workspace/LocalWorkspace.js'
import { ConstellationFS } from '../src/config/Config.js'

describe('LocalWorkspace', () => {
  let backend: LocalBackend
  let workspace: LocalWorkspace
  const testUserId = 'test-workspace-user'

  beforeEach(async () => {
    ConstellationFS.setConfig({ workspaceRoot: '/tmp/constellation-fs-test' })
    backend = new LocalBackend({
      userId: testUserId,
      type: 'local',
      shell: 'bash',
      validateUtils: false,
      preventDangerous: true
    })

    workspace = (await backend.getWorkspace('test-workspace')) as LocalWorkspace
  })

  afterEach(async () => {
    await backend.destroy()
    ConstellationFS.reset()
  })

  describe('properties', () => {
    it('should have correct workspaceName', () => {
      expect(workspace.workspaceName).toBe('test-workspace')
    })

    it('should have correct userId', () => {
      expect(workspace.userId).toBe(testUserId)
    })

    it('should have valid workspacePath', () => {
      expect(workspace.workspacePath).toBeDefined()
      expect(workspace.workspacePath).toContain(testUserId)
      expect(workspace.workspacePath).toContain('test-workspace')
    })

    it('should reference backend', () => {
      expect(workspace.backend).toBe(backend)
    })
  })

  describe('exec', () => {
    it('should execute simple commands', async () => {
      const result = await workspace.exec('echo "hello"')
      expect(result).toBe('hello')
    })

    it('should execute commands in workspace directory', async () => {
      const pwd = await workspace.exec('pwd')
      expect(pwd).toBe(workspace.workspacePath)
    })

    it('should reject empty commands', async () => {
      await expect(workspace.exec('')).rejects.toThrow('Command cannot be empty')
      await expect(workspace.exec('   ')).rejects.toThrow('Command cannot be empty')
    })

    it('should handle command failures', async () => {
      await expect(workspace.exec('exit 1')).rejects.toThrow(FileSystemError)
    })

    it('should support piping and shell features', async () => {
      await workspace.write('test1.txt', 'line1\nline2\nline3')
      const result = await workspace.exec('cat test1.txt | grep line2')
      expect(result).toBe('line2')
    })
  })

  describe('read', () => {
    it('should read file content', async () => {
      await workspace.write('read-test.txt', 'test content')
      const content = await workspace.readFile('read-test.txt', 'utf-8')

      expect(content).toBe('test content')
    })

    it('should treat paths starting with / as workspace-relative', async () => {
      // /test.txt should be treated as <workspace>/test.txt
      await workspace.write('/test.txt', 'workspace-relative content')
      const content = await workspace.readFile('/test.txt', 'utf-8')
      expect(content).toBe('workspace-relative content')
    })

    it('should reject parent traversal', async () => {
      await expect(workspace.readFile('../../../etc/passwd', 'utf-8')).rejects.toThrow()
    })

    it('should throw when file does not exist', async () => {
      await expect(workspace.readFile('nonexistent.txt', 'utf-8')).rejects.toThrow()
    })

    it('should read files in subdirectories', async () => {
      await workspace.mkdir('subdir')
      await workspace.write('subdir/nested.txt', 'nested content')

      const content = await workspace.readFile('subdir/nested.txt', 'utf-8')
      expect(content).toBe('nested content')
    })

    it('should handle empty files', async () => {
      await workspace.write('empty.txt', '')
      const content = await workspace.readFile('empty.txt', 'utf-8')

      expect(content).toBe('')
    })
  })

  describe('write', () => {
    it('should write file content', async () => {
      await workspace.write('write-test.txt', 'new content')
      const content = await workspace.readFile('write-test.txt', 'utf-8')

      expect(content).toBe('new content')
    })

    it('should overwrite existing files', async () => {
      await workspace.write('overwrite.txt', 'original')
      await workspace.write('overwrite.txt', 'updated')

      const content = await workspace.readFile('overwrite.txt', 'utf-8')
      expect(content).toBe('updated')
    })

    it('should treat paths starting with / as workspace-relative', async () => {
      // /tmp/test.txt should be treated as <workspace>/tmp/test.txt
      await workspace.write('/tmp/test.txt', 'workspace content')
      const content = await workspace.readFile('/tmp/test.txt', 'utf-8')
      expect(content).toBe('workspace content')
    })

    it('should reject parent traversal', async () => {
      await expect(workspace.write('../escape.txt', 'content')).rejects.toThrow('Path escapes workspace')
    })

    it('should create parent directories if they exist', async () => {
      await workspace.mkdir('parent')
      await workspace.write('parent/child.txt', 'nested write')

      const content = await workspace.readFile('parent/child.txt', 'utf-8')
      expect(content).toBe('nested write')
    })

    it('should handle unicode content', async () => {
      const unicodeContent = 'Hello World'
      await workspace.write('unicode.txt', unicodeContent)

      const content = await workspace.readFile('unicode.txt', 'utf-8')
      expect(content).toBe(unicodeContent)
    })

    it('should handle multiline content', async () => {
      const multiline = 'line1\nline2\nline3'
      await workspace.write('multiline.txt', multiline)

      const content = await workspace.readFile('multiline.txt', 'utf-8')
      expect(content).toBe(multiline)
    })
  })

  describe('mkdir', () => {
    it('should create directory', async () => {
      await workspace.mkdir('new-dir')
      const result = await workspace.exec('test -d new-dir && echo "exists"')

      expect(result).toBe('exists')
    })

    it('should create nested directories recursively by default', async () => {
      await workspace.mkdir('parent/child/grandchild')
      const result = await workspace.exec('test -d parent/child/grandchild && echo "exists"')

      expect(result).toBe('exists')
    })

    it('should not fail if directory already exists', async () => {
      await workspace.mkdir('existing')
      await expect(workspace.mkdir('existing')).resolves.not.toThrow()
    })

    it('should treat paths starting with / as workspace-relative', async () => {
      // /tmp/dir should be treated as <workspace>/tmp/dir
      await workspace.mkdir('/tmp/dir')
      const result = await workspace.exec('test -d tmp/dir && echo "exists"')
      expect(result).toBe('exists')
    })

    it('should reject parent traversal', async () => {
      await expect(workspace.mkdir('../escape')).rejects.toThrow('Path escapes workspace')
    })
  })

  describe('touch', () => {
    it('should create empty file', async () => {
      await workspace.touch('touched.txt')
      const content = await workspace.readFile('touched.txt', 'utf-8')

      expect(content).toBe('')
    })

    it('should create file in subdirectory', async () => {
      await workspace.mkdir('subdir')
      await workspace.touch('subdir/file.txt')

      const content = await workspace.readFile('subdir/file.txt', 'utf-8')
      expect(content).toBe('')
    })

    it('should not overwrite existing file content', async () => {
      await workspace.write('existing.txt', 'original content')
      await workspace.touch('existing.txt')

      const content = await workspace.readFile('existing.txt', 'utf-8')
      expect(content).toBe('original content')
    })

    it('should treat paths starting with / as workspace-relative', async () => {
      // /tmp/file.txt should be treated as <workspace>/tmp/file.txt
      await workspace.touch('/tmp/file.txt')
      const result = await workspace.exec('test -f tmp/file.txt && echo "exists"')
      expect(result).toBe('exists')
    })

    it('should reject parent traversal', async () => {
      await expect(workspace.touch('../escape.txt')).rejects.toThrow('Path escapes workspace')
    })
  })

  describe('exists', () => {
    it('should return true for existing file', async () => {
      await workspace.write('exists-test.txt', 'content')
      const exists = await workspace.exists('exists-test.txt')
      expect(exists).toBe(true)
    })

    it('should return false for non-existent file', async () => {
      const exists = await workspace.exists('nonexistent.txt')
      expect(exists).toBe(false)
    })

    it('should return true for existing directory', async () => {
      await workspace.mkdir('test-dir')
      const exists = await workspace.exists('test-dir')
      expect(exists).toBe(true)
    })

    it('should work with workspace root path (.)', async () => {
      const exists = await workspace.exists('.')
      expect(exists).toBe(true)
    })
  })

  describe('delete', () => {
    it('should delete workspace directory', async () => {
      const tempWorkspace = (await backend.getWorkspace('temp-delete')) as LocalWorkspace
      await tempWorkspace.write('test.txt', 'content')

      expect(await tempWorkspace.exists('.')).toBe(true)

      await tempWorkspace.delete()

      expect(await tempWorkspace.exists('.')).toBe(false)
    })

    it('should delete workspace with nested content', async () => {
      const tempWorkspace = (await backend.getWorkspace('temp-nested')) as LocalWorkspace

      await tempWorkspace.mkdir('dir1/dir2/dir3')
      await tempWorkspace.write('dir1/file1.txt', 'content1')
      await tempWorkspace.write('dir1/dir2/file2.txt', 'content2')
      await tempWorkspace.write('dir1/dir2/dir3/file3.txt', 'content3')

      await tempWorkspace.delete()

      expect(await tempWorkspace.exists('.')).toBe(false)
    })
  })

  describe('list', () => {
    it('should list files and directories', async () => {
      await workspace.write('file1.txt', 'content1')
      await workspace.write('file2.txt', 'content2')
      await workspace.mkdir('dir1')

      const items = await workspace.list()

      expect(items).toContain('file1.txt')
      expect(items).toContain('file2.txt')
      expect(items).toContain('dir1')
    })

    it('should return empty array for empty workspace', async () => {
      const emptyWorkspace = (await backend.getWorkspace('empty-list')) as LocalWorkspace

      const items = await emptyWorkspace.list()

      expect(items).toEqual([])
    })

    it('should not list items from parent directories', async () => {
      await workspace.write('workspace-file.txt', 'content')

      const items = await workspace.list()

      // Should only contain items in this workspace
      expect(items).toContain('workspace-file.txt')
      expect(items.every(item => !item.includes('..'))).toBe(true)
    })
  })

  describe('security and isolation', () => {
    it('should prevent symlink escape attempts', async () => {
      // Symlink creation commands are dangerous and blocked
      await expect(
        workspace.exec('ln -s ../../ escape-link')
      ).rejects.toThrow('Dangerous')
    })

    it('should validate all paths before operations', async () => {
      // Paths that should still be rejected (escaping workspace or home directory references)
      const dangerousPaths = [
        '../../../etc/passwd',  // Parent traversal escape
        '~/secrets',            // Home directory reference
      ]

      for (const path of dangerousPaths) {
        await expect(workspace.readFile(path, 'utf-8')).rejects.toThrow()
        await expect(workspace.write(path, 'bad')).rejects.toThrow()
      }

      // Paths starting with / should now be treated as workspace-relative
      await workspace.mkdir('/etc')
      await workspace.write('/etc/passwd', 'test')
      await expect(workspace.readFile('/etc/passwd', 'utf-8')).resolves.toBe('test')
    })

    it('should maintain workspace isolation across operations', async () => {
      const ws1 = (await backend.getWorkspace('isolated-1')) as LocalWorkspace
      const ws2 = (await backend.getWorkspace('isolated-2')) as LocalWorkspace

      await ws1.write('secret.txt', 'ws1 secret')
      await ws2.write('secret.txt', 'ws2 secret')

      const ws1Content = await ws1.readFile('secret.txt', 'utf-8')
      const ws2Content = await ws2.readFile('secret.txt', 'utf-8')

      expect(ws1Content).toBe('ws1 secret')
      expect(ws2Content).toBe('ws2 secret')
    })
  })

  describe('error handling', () => {
    it('should wrap errors with FileSystemError', async () => {
      try {
        await workspace.readFile('nonexistent.txt', 'utf-8')
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).toBeInstanceOf(FileSystemError)
        expect((error as FileSystemError).code).toBe('READ_FAILED')
      }
    })

    it('should not double-wrap FileSystemError', async () => {
      try {
        await workspace.readFile('/etc/passwd', 'utf-8')
      } catch (error) {
        expect(error).toBeInstanceOf(FileSystemError)
        // Should be the original FileSystemError, not wrapped again
      }
    })

    it('should include operation context in errors', async () => {
      try {
        await workspace.readFile('missing.txt', 'utf-8')
      } catch (error) {
        expect(error).toBeInstanceOf(FileSystemError)
        const fsError = error as FileSystemError
        expect(fsError.message).toContain('Read file failed')
      }
    })
  })

  describe('fileExists', () => {
    it('should return true for existing file', async () => {
      await workspace.write('exists-test.txt', 'content')
      const exists = await workspace.fileExists('exists-test.txt')
      expect(exists).toBe(true)
    })

    it('should return false for non-existent file', async () => {
      const exists = await workspace.fileExists('nonexistent.txt')
      expect(exists).toBe(false)
    })

    it('should return true for existing directory', async () => {
      await workspace.mkdir('test-dir')
      const exists = await workspace.fileExists('test-dir')
      expect(exists).toBe(true)
    })

    it('should return true for nested files', async () => {
      await workspace.mkdir('parent')
      await workspace.write('parent/child.txt', 'nested')
      const exists = await workspace.fileExists('parent/child.txt')
      expect(exists).toBe(true)
    })

    it('should return false for path escape attempts', async () => {
      const exists = await workspace.fileExists('../../../etc/passwd')
      expect(exists).toBe(false)
    })

    it('should validate empty paths', async () => {
      await expect(workspace.fileExists('')).rejects.toThrow('Path cannot be empty')
    })
  })

  describe('readdir', () => {
    it('should read directory contents', async () => {
      await workspace.mkdir('dir-test')
      await workspace.write('dir-test/file1.txt', 'content1')
      await workspace.write('dir-test/file2.txt', 'content2')

      const files = await workspace.readdir('dir-test')
      expect(files).toHaveLength(2)
      expect(files).toContain('file1.txt')
      expect(files).toContain('file2.txt')
    })

    it('should read directory with withFileTypes option', async () => {
      await workspace.mkdir('types-test')
      await workspace.write('types-test/file.txt', 'content')
      await workspace.mkdir('types-test/subdir')

      const entries = await workspace.readdir('types-test', { withFileTypes: true })
      expect(entries).toHaveLength(2)

      const dirents = entries as import('fs').Dirent[]
      const file = dirents.find(e => e.name === 'file.txt')
      const dir = dirents.find(e => e.name === 'subdir')

      expect(file?.isFile()).toBe(true)
      expect(dir?.isDirectory()).toBe(true)
    })

    it('should read nested directory', async () => {
      await workspace.mkdir('parent/child')
      await workspace.write('parent/child/nested.txt', 'nested')

      const files = await workspace.readdir('parent/child')
      expect(files).toContain('nested.txt')
    })

    it('should throw for non-existent directory', async () => {
      await expect(workspace.readdir('nonexistent')).rejects.toThrow(FileSystemError)
    })

    it('should treat paths starting with / as workspace-relative', async () => {
      // /etc should be treated as <workspace>/etc
      await workspace.mkdir('/etc')
      await workspace.write('/etc/passwd', 'test content')
      const files = await workspace.readdir('/etc')
      expect(files).toContain('passwd')
    })

    it('should validate empty paths', async () => {
      await expect(workspace.readdir('')).rejects.toThrow('Path cannot be empty')
    })
  })

  describe('readFile', () => {
    it('should read file contents as Buffer when no encoding specified', async () => {
      await workspace.write('readfile-test.txt', 'test content')
      const content = await workspace.readFile('readfile-test.txt')
      expect(content).toBeInstanceOf(Buffer)
      expect(content.toString('utf-8')).toBe('test content')
    })

    it('should read file with encoding as string', async () => {
      await workspace.write('encoding-test.txt', 'encoded content')
      const content = await workspace.readFile('encoding-test.txt', 'utf-8')
      expect(typeof content).toBe('string')
      expect(content).toBe('encoded content')
    })

    it('should read nested files as Buffer by default', async () => {
      await workspace.mkdir('nested')
      await workspace.write('nested/file.txt', 'nested content')
      const content = await workspace.readFile('nested/file.txt')
      expect(content).toBeInstanceOf(Buffer)
      expect(content.toString('utf-8')).toBe('nested content')
    })

    it('should throw for non-existent file', async () => {
      await expect(workspace.readFile('nonexistent.txt')).rejects.toThrow(FileSystemError)
    })

    it('should treat paths starting with / as workspace-relative', async () => {
      // /etc/passwd should be treated as <workspace>/etc/passwd
      await workspace.mkdir('/etc')
      await workspace.write('/etc/passwd', 'test content')
      const content = await workspace.readFile('/etc/passwd', 'utf-8')
      expect(content).toBe('test content')
    })

    it('should validate empty paths', async () => {
      await expect(workspace.readFile('')).rejects.toThrow('Path cannot be empty')
    })
  })

  describe('writeFile', () => {
    it('should write file contents', async () => {
      await workspace.writeFile('writefile-test.txt', 'new content')
      const content = await workspace.readFile('writefile-test.txt', 'utf-8')
      expect(content).toBe('new content')
    })

    it('should write file with encoding', async () => {
      await workspace.writeFile('encoding-write.txt', 'encoded write', 'utf-8')
      const content = await workspace.readFile('encoding-write.txt', 'utf-8')
      expect(content).toBe('encoded write')
    })

    it('should create parent directories automatically', async () => {
      await workspace.writeFile('auto-dir/file.txt', 'auto content')
      const content = await workspace.readFile('auto-dir/file.txt', 'utf-8')
      expect(content).toBe('auto content')
    })

    it('should overwrite existing files', async () => {
      await workspace.writeFile('overwrite.txt', 'original')
      await workspace.writeFile('overwrite.txt', 'updated')
      const content = await workspace.readFile('overwrite.txt', 'utf-8')
      expect(content).toBe('updated')
    })

    it('should treat paths starting with / as workspace-relative', async () => {
      // /tmp/test.txt should be treated as <workspace>/tmp/test.txt
      await workspace.writeFile('/tmp/test.txt', 'content')
      const content = await workspace.readFile('/tmp/test.txt', 'utf-8')
      expect(content).toBe('content')
    })

    it('should validate empty paths', async () => {
      await expect(workspace.writeFile('', 'content')).rejects.toThrow('Path cannot be empty')
    })
  })

  describe('stat', () => {
    it('should return stats for file', async () => {
      await workspace.write('stat-file.txt', 'test content')
      const stats = await workspace.stat('stat-file.txt')

      expect(stats.isFile()).toBe(true)
      expect(stats.isDirectory()).toBe(false)
      expect(stats.size).toBeGreaterThan(0)
    })

    it('should return stats for directory', async () => {
      await workspace.mkdir('stat-dir')
      const stats = await workspace.stat('stat-dir')

      expect(stats.isDirectory()).toBe(true)
      expect(stats.isFile()).toBe(false)
    })

    it('should return stats for nested files', async () => {
      await workspace.mkdir('nested')
      await workspace.write('nested/file.txt', 'nested content')
      const stats = await workspace.stat('nested/file.txt')

      expect(stats.isFile()).toBe(true)
      expect(stats.size).toBe(14) // "nested content" is 14 bytes
    })

    it('should throw for non-existent file', async () => {
      await expect(workspace.stat('nonexistent.txt')).rejects.toThrow(FileSystemError)
    })

    it('should treat paths starting with / as workspace-relative', async () => {
      // /etc/passwd should be treated as <workspace>/etc/passwd
      await workspace.mkdir('/etc')
      await workspace.write('/etc/passwd', 'test content')
      const stats = await workspace.stat('/etc/passwd')
      expect(stats.isFile()).toBe(true)
    })

    it('should reject parent traversal', async () => {
      await expect(workspace.stat('../../../etc/passwd')).rejects.toThrow()
    })

    it('should validate empty paths', async () => {
      await expect(workspace.stat('')).rejects.toThrow('Path cannot be empty')
    })

    it('should include modification time', async () => {
      await workspace.write('mtime-test.txt', 'content')
      const stats = await workspace.stat('mtime-test.txt')

      expect(stats.mtime).toBeInstanceOf(Date)
      // Allow 1 second tolerance for timing differences
      expect(stats.mtime.getTime()).toBeLessThanOrEqual(Date.now() + 1000)
    })

    it('should work with fileExists for checking file type', async () => {
      await workspace.write('type-test.txt', 'file')
      await workspace.mkdir('type-dir')

      const fileExists = await workspace.fileExists('type-test.txt')
      const dirExists = await workspace.fileExists('type-dir')

      expect(fileExists).toBe(true)
      expect(dirExists).toBe(true)

      const fileStats = await workspace.stat('type-test.txt')
      const dirStats = await workspace.stat('type-dir')

      expect(fileStats.isFile()).toBe(true)
      expect(dirStats.isDirectory()).toBe(true)
    })
  })

  describe('integration tests', () => {
    it('should support complete workflow', async () => {
      // Create directory structure
      await workspace.mkdir('src/utils')

      // Create files
      await workspace.write('src/index.ts', 'export * from "./utils"')
      await workspace.write('src/utils/helper.ts', 'export const help = true')

      // Read files
      const indexContent = await workspace.readFile('src/index.ts', 'utf-8')
      expect(indexContent).toBe('export * from "./utils"')

      // List files
      const srcItems = await workspace.exec('find src -type f')
      expect(srcItems).toContain('src/index.ts')
      expect(srcItems).toContain('src/utils/helper.ts')

      // Execute commands
      const fileCount = await workspace.exec('find src -type f | wc -l')
      expect(parseInt(fileCount.trim())).toBe(2)
    })

    it('should handle concurrent operations', async () => {
      const operations = []

      for (let i = 0; i < 10; i++) {
        operations.push(workspace.write(`file-${i}.txt`, `content ${i}`))
      }

      await Promise.all(operations)

      const items = await workspace.list()
      expect(items.length).toBeGreaterThanOrEqual(10)

      for (let i = 0; i < 10; i++) {
        const content = await workspace.readFile(`file-${i}.txt`, 'utf-8')
        expect(content).toBe(`content ${i}`)
      }
    })
  })

  describe('path format flexibility', () => {
    it('should support all three path formats for the same file', async () => {
      // Create a file using relative path
      await workspace.write('test.txt', 'content')

      // Read using relative path
      const content1 = await workspace.readFile('test.txt', 'utf-8')
      expect(content1).toBe('content')

      // Read using workspace-absolute path (/test.txt)
      const content2 = await workspace.readFile('/test.txt', 'utf-8')
      expect(content2).toBe('content')

      // Read using full absolute path
      const fullPath = `${workspace.workspacePath}/test.txt`
      const content3 = await workspace.readFile(fullPath, 'utf-8')
      expect(content3).toBe('content')

      // All three formats should access the same file
      expect(content1).toBe(content2)
      expect(content2).toBe(content3)
    })

    it('should support nested paths in all formats', async () => {
      await workspace.mkdir('dir')
      await workspace.write('dir/nested.txt', 'nested content')

      // Relative path
      const content1 = await workspace.readFile('dir/nested.txt', 'utf-8')
      expect(content1).toBe('nested content')

      // Workspace-absolute path
      const content2 = await workspace.readFile('/dir/nested.txt', 'utf-8')
      expect(content2).toBe('nested content')

      // Full absolute path
      const fullPath = `${workspace.workspacePath}/dir/nested.txt`
      const content3 = await workspace.readFile(fullPath, 'utf-8')
      expect(content3).toBe('nested content')

      expect(content1).toBe(content2)
      expect(content2).toBe(content3)
    })

    it('should support exists() with all three path formats', async () => {
      await workspace.write('exists-test.txt', 'content')

      // Relative path
      expect(await workspace.exists('exists-test.txt')).toBe(true)

      // Workspace-absolute path
      expect(await workspace.exists('/exists-test.txt')).toBe(true)

      // Full absolute path
      const fullPath = `${workspace.workspacePath}/exists-test.txt`
      expect(await workspace.exists(fullPath)).toBe(true)
    })

    it('should support mkdir with all three path formats', async () => {
      // Relative path
      await workspace.mkdir('dir1')
      expect(await workspace.exists('dir1')).toBe(true)

      // Workspace-absolute path
      await workspace.mkdir('/dir2')
      expect(await workspace.exists('dir2')).toBe(true)

      // Full absolute path
      const fullPath = `${workspace.workspacePath}/dir3`
      await workspace.mkdir(fullPath)
      expect(await workspace.exists('dir3')).toBe(true)
    })

    it('should support write with all three path formats', async () => {
      // Relative path
      await workspace.write('file1.txt', 'content1')
      expect(await workspace.readFile('file1.txt', 'utf-8')).toBe('content1')

      // Workspace-absolute path
      await workspace.write('/file2.txt', 'content2')
      expect(await workspace.readFile('file2.txt', 'utf-8')).toBe('content2')

      // Full absolute path
      const fullPath = `${workspace.workspacePath}/file3.txt`
      await workspace.write(fullPath, 'content3')
      expect(await workspace.readFile('file3.txt', 'utf-8')).toBe('content3')
    })

    it('should support readdir with all three path formats', async () => {
      await workspace.mkdir('readdir-test')
      await workspace.write('readdir-test/file1.txt', 'content1')
      await workspace.write('readdir-test/file2.txt', 'content2')

      // Relative path
      const files1 = await workspace.readdir('readdir-test')
      expect(files1).toContain('file1.txt')
      expect(files1).toContain('file2.txt')

      // Workspace-absolute path
      const files2 = await workspace.readdir('/readdir-test')
      expect(files2).toContain('file1.txt')
      expect(files2).toContain('file2.txt')

      // Full absolute path
      const fullPath = `${workspace.workspacePath}/readdir-test`
      const files3 = await workspace.readdir(fullPath)
      expect(files3).toContain('file1.txt')
      expect(files3).toContain('file2.txt')

      expect(files1).toEqual(files2)
      expect(files2).toEqual(files3)
    })

    it('should support stat with all three path formats', async () => {
      await workspace.write('stat-test.txt', 'content')

      // Relative path
      const stats1 = await workspace.stat('stat-test.txt')
      expect(stats1.isFile()).toBe(true)

      // Workspace-absolute path
      const stats2 = await workspace.stat('/stat-test.txt')
      expect(stats2.isFile()).toBe(true)

      // Full absolute path
      const fullPath = `${workspace.workspacePath}/stat-test.txt`
      const stats3 = await workspace.stat(fullPath)
      expect(stats3.isFile()).toBe(true)

      // All should return the same file stats
      expect(stats1.size).toBe(stats2.size)
      expect(stats2.size).toBe(stats3.size)
    })

    it('should handle workspace root path in all formats', async () => {
      // Relative path (.)
      expect(await workspace.exists('.')).toBe(true)

      // Workspace-absolute path (/)
      expect(await workspace.exists('/')).toBe(true)

      // Full absolute path (workspace path itself)
      expect(await workspace.exists(workspace.workspacePath)).toBe(true)
    })

    it('should reject absolute paths outside workspace', async () => {
      // Absolute path that doesn't match workspace should be treated as workspace-relative
      // e.g., /etc/passwd becomes <workspace>/etc/passwd
      await workspace.mkdir('/etc')
      await workspace.write('/etc/passwd', 'safe content')

      // Should create the file inside workspace
      const content = await workspace.readFile('etc/passwd', 'utf-8')
      expect(content).toBe('safe content')

      // Real system /etc/passwd should not be accessible via parent traversal
      await expect(workspace.readFile('/../../../etc/passwd', 'utf-8')).rejects.toThrow()
    })
  })
})
