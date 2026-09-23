import type { FileBasedBackend } from '../../../src/types.js'
import { describe, expect, it, vi } from 'vitest'
import { AgentBackendMCPServer } from '../../../src/server/AgentBackendMCPServer.js'
import {
  DEFAULT_LIMIT,
  LINE_TRUNCATION_THRESHOLD,
  MAX_LIMIT,
} from '../../../src/server/tools.js'

interface ToolResult {
  content: Array<{ type: string, text?: string, data?: string, mimeType?: string }>
  isError?: boolean
}

interface ToolEntry {
  name: string
  description: string
  inputSchema: unknown
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (args: any, ctx: { sessionId?: string }) => Promise<ToolResult>
}

function makeBackend(
  fileContent: string | Buffer | Error,
  fileSizeBytes?: number,
): FileBasedBackend {
  const read = vi.fn().mockImplementation(async (_path: string, options?: { encoding?: 'utf8' | 'buffer' }) => {
    if (fileContent instanceof Error) throw fileContent
    const buffer = Buffer.isBuffer(fileContent) ? fileContent : Buffer.from(fileContent, 'utf8')
    return options?.encoding === 'buffer' ? buffer : buffer.toString('utf8')
  })
  const stat = vi.fn().mockResolvedValue({
    isFile: () => true,
    isDirectory: () => false,
    size: fileSizeBytes ?? (fileContent instanceof Error ? 0 : Buffer.byteLength(fileContent)),
    mtime: new Date(),
    atime: new Date(),
    birthtime: new Date(),
    mode: 0o644,
  })
  return {
    type: 'LocalFilesystem',
    rootDir: '/test',
    connected: true,
    read,
    write: vi.fn(),
    readdir: vi.fn(),
    mkdir: vi.fn(),
    exists: vi.fn(),
    stat,
    exec: vi.fn(),
    touch: vi.fn(),
    scope: vi.fn(),
    listActiveScopes: vi.fn().mockResolvedValue([]),
    getMCPClient: vi.fn(),
    destroy: vi.fn(),
  } as unknown as FileBasedBackend
}

function getReadTool(backend: FileBasedBackend): ToolEntry {
  const server = new AgentBackendMCPServer(backend)
  return server.server.getTools()['read_file'] as unknown as ToolEntry
}

async function call(
  tool: ToolEntry,
  args: Record<string, unknown>,
): Promise<string> {
  const result = await tool.handler(args, {})
  return result.content[0].text ?? ''
}

describe('read_file — text paging and truncation', () => {
  describe('small files (no footer)', () => {
    it('returns the full body with no footer when file fits under DEFAULT_LIMIT', async () => {
      const lines = Array.from({ length: 80 }, (_, i) => `line ${i + 1}`)
      const content = lines.join('\n')
      const tool = getReadTool(makeBackend(content))

      const text = await call(tool, { path: 'app.json' })
      expect(text).toBe(content)
      expect(text).not.toMatch(/\[showing/)
    })

    it('returns an empty body with no footer for an empty file', async () => {
      const tool = getReadTool(makeBackend(''))
      const text = await call(tool, { path: 'empty.txt' })
      expect(text).toBe('')
    })
  })

  describe('implicit paging', () => {
    it('clips large files to DEFAULT_LIMIT and appends the implicit footer with size', async () => {
      const totalLines = 4512
      const lines = Array.from({ length: totalLines }, (_, i) => `line ${i + 1}`)
      const content = lines.join('\n')
      // Force a ~1.4 MB size independent of the synthetic content length.
      const tool = getReadTool(makeBackend(content, 1_468_006))

      const text = await call(tool, { path: 'worker.log' })
      const lastNewline = text.lastIndexOf('\n')
      const footer = text.slice(lastNewline + 1)
      const body = text.slice(0, lastNewline)

      expect(body.split('\n')).toHaveLength(DEFAULT_LIMIT)
      expect(body.split('\n')[0]).toBe('line 1')
      expect(body.split('\n')[DEFAULT_LIMIT - 1]).toBe(`line ${DEFAULT_LIMIT}`)
      expect(footer).toBe(
        '[showing lines 1-1,000 of 4,512; file is ~1.4 MB. Call again with offset and limit to read more.]',
      )
    })
  })

  describe('explicit paging (offset / limit)', () => {
    it('slices by offset + limit and uses the short explicit footer', async () => {
      const totalLines = 120000
      const content = Array.from({ length: totalLines }, (_, i) => `line ${i + 1}`).join('\n')
      const tool = getReadTool(makeBackend(content))

      const text = await call(tool, { path: 'worker.log', offset: 50000, limit: 200 })
      const [body, footer] = text.split(/\n(?=\[showing)/)

      const bodyLines = body.split('\n')
      expect(bodyLines).toHaveLength(200)
      expect(bodyLines[0]).toBe('line 50000')
      expect(bodyLines[199]).toBe('line 50199')
      expect(footer).toBe('[showing lines 50,000-50,199 of 120,000.]')
    })

    it('omits the footer when offset=1 and the slice covers the whole file', async () => {
      const content = Array.from({ length: 10 }, (_, i) => `l${i}`).join('\n')
      const tool = getReadTool(makeBackend(content))
      const text = await call(tool, { path: 'small.txt', offset: 1, limit: 50 })
      expect(text).toBe(content)
    })

    it('still appends a footer when offset>1 even if the slice reaches the end', async () => {
      const content = Array.from({ length: 10 }, (_, i) => `l${i}`).join('\n')
      const tool = getReadTool(makeBackend(content))
      const text = await call(tool, { path: 'small.txt', offset: 5, limit: 100 })
      expect(text).toMatch(/\[showing lines 5-10 of 10\.\]$/)
    })

    it('returns an empty body and a past-end footer for out-of-range offset', async () => {
      const content = Array.from({ length: 100 }, (_, i) => `l${i}`).join('\n')
      const tool = getReadTool(makeBackend(content))
      const text = await call(tool, { path: 'short.txt', offset: 50000 })
      expect(text).toBe('[offset 50,000 is beyond end of file (100 lines).]')
    })

    it('clamps limit above MAX_LIMIT silently', async () => {
      const total = MAX_LIMIT + 500
      const content = Array.from({ length: total }, (_, i) => `l${i}`).join('\n')
      const tool = getReadTool(makeBackend(content))
      const text = await call(tool, { path: 'x.txt', offset: 1, limit: MAX_LIMIT + 10_000 })
      const body = text.split(/\n(?=\[showing)/)[0]
      expect(body.split('\n')).toHaveLength(MAX_LIMIT)
      expect(text).toMatch(new RegExp(`\\[showing lines 1-${MAX_LIMIT.toLocaleString('en-US')} of ${total.toLocaleString('en-US')}\\.\\]$`))
    })
  })

  describe('single paging mode', () => {
    it('exposes only path/offset/limit — no head or tail parameter', async () => {
      const tool = getReadTool(makeBackend('a\nb'))
      const schema = tool.inputSchema as Record<string, unknown>
      expect(Object.keys(schema)).toEqual(expect.arrayContaining(['path', 'offset', 'limit']))
      expect(Object.keys(schema)).not.toContain('head')
      expect(Object.keys(schema)).not.toContain('tail')
    })

    it('does not advertise MAX_LIMIT in model-visible text', async () => {
      const tool = getReadTool(makeBackend('a\nb'))
      expect(tool.description).not.toContain(String(MAX_LIMIT))
    })

    it('serves a first-N-lines read via offset 1 + limit', async () => {
      const content = Array.from({ length: 4512 }, (_, i) => `l${i}`).join('\n')
      const tool = getReadTool(makeBackend(content))
      const text = await call(tool, { path: 'big.log', offset: 1, limit: 100 })
      const body = text.split(/\n(?=\[showing)/)[0]
      expect(body.split('\n')).toHaveLength(100)
      expect(text).toMatch(/\[showing lines 1-100 of 4,512\.\]$/)
    })

    it('omits the footer when an explicit page covers the whole file', async () => {
      const content = Array.from({ length: 10 }, (_, i) => `l${i}`).join('\n')
      const tool = getReadTool(makeBackend(content))
      const text = await call(tool, { path: 'x', offset: 1, limit: 100 })
      expect(text).toBe(content)
    })
  })

  describe('line truncation', () => {
    it('clips a single long line inline with a marker showing original length', async () => {
      const longLine = 'x'.repeat(1_100_000)
      const tool = getReadTool(makeBackend(longLine, 1_153_433))

      const text = await call(tool, { path: 'bundle.min.js' })
      // inline marker
      expect(text).toContain(`… [line truncated, original ${longLine.length} chars]`)
      const [body, footer] = text.split(/\n(?=\[showing)/)
      // body is just the clipped single line + marker
      expect(body.startsWith('x'.repeat(LINE_TRUNCATION_THRESHOLD))).toBe(true)
      // implicit-mode footer appears even though sliceEnd == totalLines
      expect(footer).toBe(
        '[showing lines 1-1 of 1; file is ~1.1 MB. Call again with offset and limit to read more.]',
      )
    })

    it('does NOT emit an implicit footer for a small file with no long lines', async () => {
      const content = 'short content'
      const tool = getReadTool(makeBackend(content))
      const text = await call(tool, { path: 'x.txt' })
      expect(text).toBe(content)
    })

    it('leaves lines at exactly LINE_TRUNCATION_THRESHOLD untouched', async () => {
      const exact = 'a'.repeat(LINE_TRUNCATION_THRESHOLD)
      const tool = getReadTool(makeBackend(exact))
      const text = await call(tool, { path: 'x.txt' })
      expect(text).toBe(exact)
    })
  })

  describe('no mode-conflict rejection', () => {
    it('serves a read that also carries the removed head/tail keys instead of throwing', async () => {
      const content = Array.from({ length: 200 }, (_, i) => `l${i}`).join('\n')
      const tool = getReadTool(makeBackend(content))
      // The exact shape models were sending against the old four-parameter schema.
      const text = await call(tool, {
        path: 'x',
        offset: 1,
        limit: MAX_LIMIT,
        head: MAX_LIMIT,
        tail: MAX_LIMIT,
      })
      expect(text).toBe(content)
    })
  })

  describe('error passthrough', () => {
    it('surfaces backend read errors unchanged (e.g. file not found)', async () => {
      const tool = getReadTool(makeBackend(new Error('ENOENT: no such file')))
      await expect(call(tool, { path: 'nope.txt' })).rejects.toThrow('ENOENT: no such file')
    })
  })

  describe('size suffix formatting', () => {
    // Run read_file in implicit mode with various stat sizes and read the suffix.
    async function sizeSuffix(bytes: number): Promise<string> {
      const content = Array.from({ length: DEFAULT_LIMIT + 1 }, () => 'x').join('\n')
      const tool = getReadTool(makeBackend(content, bytes))
      const text = await call(tool, { path: 'x' })
      const m = text.match(/file is ~([^.]+(?:\.\d+)?\s*[KMG]?B|<1 KB)/)
      if (!m) throw new Error(`no size suffix found in: ${text}`)
      return m[1]
    }

    it('<1 KB for sub-kilobyte sizes', async () => {
      expect(await sizeSuffix(500)).toBe('<1 KB')
    })

    it('integer KB for sub-megabyte sizes', async () => {
      expect(await sizeSuffix(4 * 1024)).toBe('4 KB')
    })

    it('one-decimal MB for sub-gigabyte sizes', async () => {
      expect(await sizeSuffix(Math.round(1.4 * 1024 * 1024))).toBe('1.4 MB')
    })

    it('one-decimal GB for gigabyte-and-up sizes', async () => {
      expect(await sizeSuffix(Math.round(2.5 * 1024 * 1024 * 1024))).toBe('2.5 GB')
    })
  })
})

describe('read_file — type dispatch', () => {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00])

  it('returns an image block for image files', async () => {
    const result = await getReadTool(makeBackend(PNG)).handler({ path: 'logo.png' }, {})
    expect(result.content).toEqual([{ type: 'image', data: PNG.toString('base64'), mimeType: 'image/png' }])
    expect(result.isError).toBeUndefined()
  })

  it('returns an audio block for audio files', async () => {
    const bytes = Buffer.from([0xff, 0xfb, 0x00, 0x01])
    const result = await getReadTool(makeBackend(bytes)).handler({ path: 'clip.mp3' }, {})
    expect(result.content).toEqual([{ type: 'audio', data: bytes.toString('base64'), mimeType: 'audio/mpeg' }])
  })

  it('ignores paging params and force for media files', async () => {
    const result = await getReadTool(makeBackend(PNG)).handler({ path: 'logo.png', offset: 3, limit: 1, force: true }, {})
    expect(result.content[0]).toMatchObject({ type: 'image', data: PNG.toString('base64') })
  })

  it('reads SVG as text rather than as an image', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'
    const result = await getReadTool(makeBackend(svg)).handler({ path: 'icon.svg' }, {})
    expect(result.content).toEqual([{ type: 'text', text: svg }])
  })

  it('reads text files with an unknown extension as text', async () => {
    const text = await call(getReadTool(makeBackend('export const x = 1\n')), { path: 'src/x.ts' })
    expect(text).toBe('export const x = 1\n')
  })

  it('returns file info with isError for a NUL-containing file with no known extension', async () => {
    const bytes = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01])
    const result = await getReadTool(makeBackend(bytes)).handler({ path: 'bin/tool' }, {})
    expect(result.isError).toBe(true)
    const text = result.content[0].text ?? ''
    expect(text).toMatch(/^Unrecognized file type \(none\) for read_file/)
    expect(text).toContain('Path: bin/tool')
    expect(text).toContain('Detected MIME type: application/octet-stream')
    expect(text).toContain('Size: 6 bytes')
    expect(text).toMatch(/Modified: \d{4}-/)
    expect(text).toContain('get_file_info')
    expect(text).toContain('exec')
    expect(text).toContain('force: true')
  })

  it('only sniffs the first 8,192 bytes for NUL', async () => {
    const content = Buffer.concat([Buffer.alloc(8192, 'a'), Buffer.from([0])])
    const result = await getReadTool(makeBackend(content)).handler({ path: 'x.log' }, {})
    expect(result.isError).toBeUndefined()
    expect(result.content[0].type).toBe('text')
  })

  it('treats known binary extensions as binary even without a NUL byte', async () => {
    const result = await getReadTool(makeBackend('%PDF-1.7 no nul here')).handler({ path: 'doc.pdf' }, {})
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Detected MIME type: application/pdf')
  })

  it('returns a base64 blob for a binary file when force is true', async () => {
    const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00])
    const result = await getReadTool(makeBackend(bytes)).handler({ path: 'a.zip', force: true }, {})
    expect(result.isError).toBeUndefined()
    expect(result.content).toEqual([{ type: 'blob', data: bytes.toString('base64'), mimeType: 'application/zip' }])
  })

  it('force does not change the result for a text file', async () => {
    const content = Array.from({ length: DEFAULT_LIMIT + 5 }, (_, i) => `l${i}`).join('\n')
    const withForce = await call(getReadTool(makeBackend(content)), { path: 'x.txt', force: true })
    const without = await call(getReadTool(makeBackend(content)), { path: 'x.txt' })
    expect(withForce).toBe(without)
  })
})
