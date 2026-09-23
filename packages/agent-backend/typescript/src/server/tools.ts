import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Backend, FileBasedBackend } from '../types.js'
import { createTwoFilesPatch, FILE_HEADERS_ONLY } from 'diff'
import { minimatch } from 'minimatch'
import * as path from 'path'
import { z } from 'zod'

type BackendGetter = (sessionId?: string) => Promise<Backend> | Backend

/**
 * Default patterns to exclude from directory listings (gitignore-style).
 * These match at any depth in the tree.
 */
/**
 * read_file text paging defaults. Tunable here; callers see them via the tool's
 * footer. See opensdd/daemon.md for the behavioral contract.
 */
export const DEFAULT_LIMIT = 1000
export const MAX_LIMIT = 5000
export const LINE_TRUNCATION_THRESHOLD = 2000

export const DEFAULT_EXCLUDE_PATTERNS = [
  // Version control
  '.git',
  '.svn',
  '.hg',
  // Dependencies
  'node_modules',
  '.venv',
  'venv',
  '__pycache__',
  '.tox',
  '.nox',
  // Build artifacts
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.output',
  'target',
  // Caches
  '.cache',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  // Coverage
  'coverage',
  '.coverage',
  'htmlcov',
  // IDE
  '.idea',
  '.vscode',
  // Misc
  '.DS_Store',
  '*.egg-info',
  '.eggs',
]

/**
 * Budget for rendering an `edit_file` diff. Rendering is synchronous and runs on
 * the daemon's only thread, so the budget MUST be enforced *inside* the diff
 * loop: an external timeout (`Promise.race`, `setTimeout`, an `AbortSignal`
 * around the handler) cannot fire while the loop holds the thread, and an
 * unbounded render takes down every session the daemon serves, not just the
 * calling one. `diff` checks both of these once per iteration of its main
 * edit-length loop. See opensdd/daemon.md for the behavioral contract.
 */
export const DIFF_TIMEOUT_MS = 15_000
export const DIFF_MAX_EDIT_LENGTH = 20_000
export const DIFF_CONTEXT_LINES = 3

export interface DiffBudget {
  /** Wall-clock deadline, in ms, checked once per iteration of the diff loop. */
  timeoutMs: number
  /** Cap on line-level edits, checked once per iteration of the diff loop. */
  maxEditLength: number
}

export const DEFAULT_DIFF_BUDGET: DiffBudget = {
  timeoutMs: DIFF_TIMEOUT_MS,
  maxEditLength: DIFF_MAX_EDIT_LENGTH,
}

export interface UnifiedDiff {
  text: string
  /** True when the budget was exceeded and `text` carries the omission marker. */
  degraded: boolean
}

/**
 * Render a unified diff between two strings.
 *
 * Delegates the line matching to the `diff` library, as the official filesystem
 * server does. The previous hand-rolled version could leave both cursors parked
 * — its two lookahead heuristics each declined to advance when the diverging
 * line reappeared within 10 lines of the other side, which any adjacent
 * transposition satisfies — and then spun forever at 100% CPU, hanging the
 * daemon. It also mis-rendered larger reorderings when it did terminate.
 */
export function createUnifiedDiff(
  original: string,
  modified: string,
  filepath: string,
  budget: DiffBudget = DEFAULT_DIFF_BUDGET,
): UnifiedDiff {
  let patch: string | undefined
  try {
    patch = createTwoFilesPatch(filepath, filepath, original, modified, undefined, undefined, {
      context: DIFF_CONTEXT_LINES,
      timeout: budget.timeoutMs,
      maxEditLength: budget.maxEditLength,
      headerOptions: FILE_HEADERS_ONLY,
    })
  } catch {
    // Rendering is best-effort: the caller's edit has already been applied, so a
    // render that blows up must not take the tool result down with it.
    patch = undefined
  }

  if (patch !== undefined) {
    return { text: patch, degraded: false }
  }

  // Budget exceeded (or render threw). Describe the change rather than block on
  // it — a caller that gets no result at all is strictly worse off.
  const before = formatCount(original.split('\n').length)
  const after = formatCount(modified.split('\n').length)
  return {
    text: [
      `--- ${filepath}`,
      `+++ ${filepath}`,
      `[diff omitted: rendering exceeded the diff budget (${budget.timeoutMs / 1000}s / `
      + `${formatCount(budget.maxEditLength)} line edits); file went from ${before} to ${after} lines]`,
    ].join('\n'),
    degraded: true,
  }
}

/**
 * Format file size in human-readable format (matches official MCP filesystem server)
 */
function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  if (bytes === 0) return '0 B'

  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  if (i < 0 || i === 0) return `${bytes} ${units[0]}`

  const unitIndex = Math.min(i, units.length - 1)
  return `${(bytes / Math.pow(1024, unitIndex)).toFixed(2)} ${units[unitIndex]}`
}

/**
 * Format a byte count for the read_file text footer. Granularities mandated by spec:
 * `<1 KB`, integer KB, one-decimal MB, one-decimal GB.
 */
function formatTextFileSize(bytes: number): string {
  if (bytes < 1024) return '<1 KB'
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

/**
 * Render an integer with en-US comma thousands-separators (e.g. 4512 → "4,512").
 */
function formatCount(n: number): string {
  return n.toLocaleString('en-US')
}

/**
 * Clip a single line at LINE_TRUNCATION_THRESHOLD. Announced inline so the model
 * can tell the content is partial and route to a different tool (e.g. grep).
 */
function truncateLine(line: string): string {
  if (line.length <= LINE_TRUNCATION_THRESHOLD) return line
  return `${line.slice(0, LINE_TRUNCATION_THRESHOLD)}… [line truncated, original ${line.length} chars]`
}

/**
 * Get MIME type for a file path (simple implementation to avoid extra dependency)
 */
function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  const mimeTypes: Record<string, string> = {
    // Images
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.bmp': 'image/bmp',
    // Audio
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4',
    '.flac': 'audio/flac',
    // Video
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.avi': 'video/x-msvideo',
    '.mov': 'video/quicktime',
    // Documents
    '.pdf': 'application/pdf',
    '.json': 'application/json',
    '.xml': 'application/xml',
    // Archives
    '.zip': 'application/zip',
    '.gz': 'application/gzip',
    '.tar': 'application/x-tar',
  }
  return mimeTypes[ext] || 'application/octet-stream'
}

/**
 * Whether read_file returns this MIME type as an image/audio content block.
 * SVG is excluded: it's text that agents edit, and model APIs generally reject it as an image.
 */
function isMediaMimeType(mimeType: string): boolean {
  if (mimeType === 'image/svg+xml') return false
  return mimeType.startsWith('image/') || mimeType.startsWith('audio/')
}

const KNOWN_BINARY_MIME_TYPES = new Set([
  'application/pdf',
  'application/zip',
  'application/gzip',
  'application/x-tar',
])

/**
 * Whether the extension alone marks the file as a non-text binary. Unknown extensions
 * map to application/octet-stream and are left to content sniffing instead.
 */
function isKnownBinaryMimeType(mimeType: string): boolean {
  return mimeType.startsWith('video/') || KNOWN_BINARY_MIME_TYPES.has(mimeType)
}

/** Bytes sniffed for a NUL when deciding whether a file is binary (same heuristic as git). */
const BINARY_SNIFF_BYTES = 8192

function hasNulByte(buffer: Buffer): boolean {
  return buffer.subarray(0, BINARY_SNIFF_BYTES).includes(0)
}

/**
 * Register all filesystem tools on an MCP server.
 * Modeled on @modelcontextprotocol/server-filesystem, diverging where opensdd/daemon.md says so.
 * Does NOT include exec tool - use registerExecTool() separately for backends that support it.
 */
export function registerFilesystemTools(server: McpServer, getBackend: BackendGetter): void {

  // ─────────────────────────────────────────────────────────────────
  // READ OPERATIONS
  // ─────────────────────────────────────────────────────────────────

  server.registerTool(
    'read_file',
    {
      description: `Read a file. Text files return the first ${DEFAULT_LIMIT} lines with no paging parameters. Lines longer than ${LINE_TRUNCATION_THRESHOLD} chars truncated with an inline marker. Images and audio are returned as media content; other binary files return file info instead of their contents. To read several files, call this tool once per file in parallel.`,
      inputSchema: {
        path: z.string().describe('Path to the file'),
        offset: z.number().int().positive().optional()
          .describe('1-based line number to start reading from. Only provide if the file is too large to read at once.'),
        limit: z.number().int().positive().optional()
          .describe('Number of lines to read. Only provide if the file is too large to read at once.'),
        force: z.boolean().optional()
          .describe('Return an unrecognized binary file as a base64 blob instead of file info. Has no effect on text, image or audio files. Off by default.'),
      },
    },
    async ({ path: filePath, offset, limit, force }, { sessionId }) => {
      const backend = await getBackend(sessionId) as FileBasedBackend
      const mimeType = getMimeType(filePath)
      const buffer = await backend.read(filePath, { encoding: 'buffer' }) as Buffer

      if (isMediaMimeType(mimeType)) {
        return {
          content: [{
            type: mimeType.startsWith('image/') ? 'image' as const : 'audio' as const,
            data: buffer.toString('base64'),
            mimeType,
          }]
        }
      }

      if (isKnownBinaryMimeType(mimeType) || hasNulByte(buffer)) {
        // There's no common use for raw base64 of an arbitrary binary, so by default
        // return file-level info the model can act on. `force` is the explicit opt-in.
        if (!force) {
          const stats = await backend.stat(filePath)
          const ext = path.extname(filePath) || '(none)'
          const info = [
            `Path: ${filePath}`,
            `Extension: ${ext}`,
            `Detected MIME type: ${mimeType}`,
            `Size: ${stats.size} bytes`,
            `Modified: ${stats.mtime.toISOString()}`,
          ].join('\n')
          return {
            content: [{
              type: 'text',
              text: `Unrecognized file type ${ext} for read_file (binary content, not an image or audio file).\n\n${info}\n\nUse get_file_info for full metadata, or exec to inspect it with a command-line tool. If you really need the raw bytes, call read_file again with force: true.`,
            }],
            isError: true,
          }
        }
        return {
          content: [{
            // 'blob' is not in the SDK's content union; the spec keeps it for parity with
            // the official filesystem server's binary fallback.
            type: 'blob' as 'image',
            data: buffer.toString('base64'),
            mimeType,
          }]
        }
      }

      const allLines = buffer.toString('utf8').split('\n')
      const totalLines = allLines.length

      // Single paging mode: offset/limit. There is no invalid combination of
      // paging parameters, so nothing to reject here.
      const implicit = offset == null && limit == null
      const effectiveLimit = Math.min(limit ?? DEFAULT_LIMIT, MAX_LIMIT)
      const pageStart = offset ?? 1 // 1-based line of the first line in the slice
      const startIdx = pageStart - 1
      const slice = startIdx >= totalLines
        ? []
        : allLines.slice(startIdx, startIdx + effectiveLimit)

      const hadLineTruncation = slice.some(l => l.length > LINE_TRUNCATION_THRESHOLD)
      const truncated = slice.map(truncateLine)
      const body = truncated.join('\n')

      // Footer decision: emit whenever the slice doesn't cover the whole file —
      // plus, for implicit paging, if any line was truncated, so a pathological
      // single-line file still surfaces file size and the "call again" hint.
      let footer = ''
      const sliceEndLine = pageStart + slice.length - 1 // inclusive
      const coversWholeFile = pageStart === 1 && slice.length >= totalLines
      if (!coversWholeFile || (implicit && hadLineTruncation)) {
        if (slice.length === 0) {
          footer = `[offset ${formatCount(pageStart)} is beyond end of file (${formatCount(totalLines)} lines).]`
        } else if (implicit) {
          const stats = await backend.stat(filePath)
          const size = formatTextFileSize(stats.size)
          footer = `[showing lines ${formatCount(pageStart)}-${formatCount(sliceEndLine)} of ${formatCount(totalLines)}; file is ~${size}. Call again with offset and limit to read more.]`
        } else {
          footer = `[showing lines ${formatCount(pageStart)}-${formatCount(sliceEndLine)} of ${formatCount(totalLines)}.]`
        }
      }

      let text = body
      if (footer) {
        if (text.length > 0 && !text.endsWith('\n')) text += '\n'
        text += footer
      }

      return { content: [{ type: 'text', text }] }
    }
  )

  // ─────────────────────────────────────────────────────────────────
  // WRITE OPERATIONS
  // ─────────────────────────────────────────────────────────────────

  server.registerTool(
    'write_file',
    {
      description: 'Create new file or completely overwrite existing file with new content. Parent directories are created automatically if they don\'t exist.',
      inputSchema: {
        path: z.string().describe('Path to the file'),
        content: z.string().describe('Content to write'),
      },
    },
    async ({ path: filePath, content }, { sessionId }) => {
      const backend = await getBackend(sessionId) as FileBasedBackend

      // Ensure parent directory exists (convenience feature - official server doesn't do this)
      const dir = path.dirname(filePath)
      if (dir && dir !== '.') {
        await backend.mkdir(dir, { recursive: true })
      }

      // Note: The official MCP filesystem server uses atomic writes (temp file + rename)
      // to prevent race conditions. AgentBackend's writeFile uses standard fs.writeFile.
      // If atomic writes become necessary, this should be updated to use a temp file pattern.
      // See: https://github.com/modelcontextprotocol/servers/blob/main/src/filesystem/lib.ts
      await backend.write(filePath, content)
      return {
        content: [{ type: 'text', text: `Successfully wrote to ${filePath}` }]
      }
    }
  )

  server.registerTool(
    'edit_file',
    {
      description: 'Make selective edits using exact text matching. Each edit\'s oldText must be unique in the current file state, unless replaceAll is set for that edit. Edits apply sequentially — later edits see the result of earlier ones. Returns a unified diff of the changes.',
      inputSchema: {
        path: z.string().describe('Path to the file'),
        edits: z.array(z.object({
          oldText: z.string().describe('Text to search for — must match exactly and (unless replaceAll is true) must be unique in the current file state. Add surrounding context to disambiguate if needed.'),
          newText: z.string().describe('Text to replace with'),
          replaceAll: z.boolean().optional().describe('Replace every occurrence of oldText. Use for renames or other bulk replacements; defaults to false.'),
        })).describe('Array of edits to apply sequentially'),
        dryRun: z.boolean().optional()
          .describe('Preview changes using git-style diff format (defaults to false)'),
      },
    },
    async ({ path: filePath, edits, dryRun: dryRunParam }, { sessionId }) => {
      const dryRun = dryRunParam ?? false
      const backend = await getBackend(sessionId) as FileBasedBackend
      const original = await backend.read(filePath, { encoding: 'utf8' }) as string

      const normalizeLineEndings = (text: string) => text.replace(/\r\n/g, '\n')
      const countOccurrences = (haystack: string, needle: string): number => {
        if (needle.length === 0) return 0
        return haystack.split(needle).length - 1
      }

      const normalizedOriginal = normalizeLineEndings(original)
      let modified = normalizedOriginal

      for (let i = 0; i < edits.length; i++) {
        const edit = edits[i]
        const normalizedOld = normalizeLineEndings(edit.oldText)
        const normalizedNew = normalizeLineEndings(edit.newText)
        const replaceAll = edit.replaceAll ?? false

        const occurrences = countOccurrences(modified, normalizedOld)
        if (occurrences === 0) {
          throw new Error(`edit ${i + 1}: could not find exact match for oldText. Check whitespace and line endings, or verify the file state after any preceding edits.`)
        }
        if (occurrences > 1 && !replaceAll) {
          throw new Error(`edit ${i + 1}: oldText appears ${occurrences} times in the file; pass replaceAll: true to replace every occurrence, or add surrounding context to oldText to make it unique.`)
        }

        modified = replaceAll
          ? modified.replaceAll(normalizedOld, normalizedNew)
          : modified.replace(normalizedOld, normalizedNew)
      }

      // Write before rendering the diff. Rendering is bounded but can still
      // degrade, and an edit that has already been computed must never be lost
      // to the cost of describing it.
      const changed = modified !== normalizedOriginal
      if (!dryRun && changed) {
        await backend.write(filePath, modified)
      }

      const { text: diff, degraded } = createUnifiedDiff(normalizedOriginal, modified, filePath)

      // On a degraded render the diff no longer shows the edit landed, so say so.
      const applied = degraded && !dryRun && changed
        ? `Applied ${edits.length} edit${edits.length === 1 ? '' : 's'} to ${filePath}\n`
        : ''

      return {
        content: [{
          type: 'text',
          text: dryRun ? `[DRY RUN]\n${diff}` : `${applied}${diff}`
        }]
      }
    }
  )

  // ─────────────────────────────────────────────────────────────────
  // DIRECTORY OPERATIONS
  // ─────────────────────────────────────────────────────────────────

  server.registerTool(
    'create_directory',
    {
      description: 'Create new directory or ensure it exists. Creates parent directories automatically.',
      inputSchema: {
        path: z.string().describe('Path to the directory'),
      },
    },
    async ({ path: dirPath }, { sessionId }) => {
      const backend = await getBackend(sessionId) as FileBasedBackend
      await backend.mkdir(dirPath, { recursive: true })
      return {
        content: [{ type: 'text', text: `Created directory: ${dirPath}` }]
      }
    }
  )

  server.registerTool(
    'list_directory',
    {
      description: 'List directory contents. Use "." for the root/current directory.',
      inputSchema: {
        path: z.string().describe('Path to the directory'),
        includeSizes: z.boolean().optional()
          .describe('Include file sizes and a summary of totals. Off by default.'),
        sortBy: z.enum(['name', 'size']).optional()
          .describe('Sort entries by name or size (descending), defaults to name'),
      },
    },
    async ({ path: dirPath, includeSizes, sortBy: sortByParam }, { sessionId }) => {
      const sortBy = sortByParam ?? 'name'
      const backend = await getBackend(sessionId) as FileBasedBackend
      const entries = await backend.readdir(dirPath) as string[]

      const detailed = await Promise.all(
        entries.map(async (entry) => {
          try {
            const stats = await backend.stat(path.join(dirPath, entry))
            return stats.isDirectory()
              ? { name: entry, prefix: '[DIR]', isFile: false, size: 0 }
              : { name: entry, prefix: '[FILE]', isFile: true, size: stats.size }
          } catch {
            return { name: entry, prefix: '[?]', isFile: false, size: 0 }
          }
        })
      )

      // Size is descending; name (ascending) is the primary key for 'name' and the tiebreak for 'size'
      detailed.sort((a, b) =>
        (sortBy === 'size' ? b.size - a.size : 0) || a.name.localeCompare(b.name))

      if (!includeSizes) {
        return {
          content: [{ type: 'text', text: detailed.map(d => `${d.prefix} ${d.name}`).join('\n') }]
        }
      }

      const formatted = detailed.map(d =>
        d.isFile ? `${d.prefix} ${d.name.padEnd(30)} ${formatSize(d.size)}` : `${d.prefix} ${d.name}`)

      const files = detailed.filter(d => d.isFile)
      const dirCount = detailed.filter(d => d.prefix === '[DIR]').length
      const totalSize = files.reduce((sum, d) => sum + d.size, 0)

      formatted.push('')
      formatted.push(`Total: ${files.length} files, ${dirCount} directories`)
      formatted.push(`Combined size: ${formatSize(totalSize)}`)

      return {
        content: [{ type: 'text', text: formatted.join('\n') }]
      }
    }
  )

  server.registerTool(
    'directory_tree',
    {
      description: 'Get recursive JSON tree structure of directory contents. Each entry includes name, type (file/directory), and children for directories. By default excludes common non-essential directories (node_modules, .venv, .git, etc.).',
      inputSchema: {
        path: z.string().describe('Path to the directory'),
        excludePatterns: z.array(z.string()).optional()
          .describe('Additional glob patterns to exclude (e.g., "*.log", "temp")'),
        includeDefaultExcludes: z.boolean().optional().default(true)
          .describe('Include default exclusions (node_modules, .venv, .git, etc.). Set to false to disable.'),
      },
    },
    async ({ path: dirPath, excludePatterns: excludePatternsParam, includeDefaultExcludes }, { sessionId }) => {
      // Combine default excludes with user-provided patterns
      const defaultExcludes = includeDefaultExcludes !== false ? DEFAULT_EXCLUDE_PATTERNS : []
      const excludePatterns = [...defaultExcludes, ...(excludePatternsParam ?? [])]
      const backend = await getBackend(sessionId) as FileBasedBackend

      interface TreeNode {
        name: string
        type: 'directory' | 'file'
        size?: number
        children?: TreeNode[]
      }

      async function buildTree(currentPath: string): Promise<TreeNode[]> {
        const entries = await backend.readdir(currentPath) as string[]
        const children: TreeNode[] = []

        for (const entry of entries) {
          const entryPath = path.join(currentPath, entry)
          const relativePath = path.relative(dirPath, entryPath)

          // Use minimatch for proper glob pattern matching (matches official server behavior)
          const shouldExclude = excludePatterns.some((pattern: string) => {
            // Support both exact matches and glob patterns
            if (pattern.includes('*')) {
              return minimatch(relativePath, pattern, { dot: true })
            }
            // For non-glob patterns, match as directory/file name or path component
            return minimatch(relativePath, pattern, { dot: true }) ||
              minimatch(relativePath, `**/${pattern}`, { dot: true }) ||
              minimatch(relativePath, `**/${pattern}/**`, { dot: true })
          })

          if (shouldExclude) continue

          try {
            const stats = await backend.stat(entryPath)
            if (stats.isDirectory()) {
              children.push({
                name: entry,
                type: 'directory',
                children: await buildTree(entryPath),
              })
            } else {
              children.push({
                name: entry,
                type: 'file',
                size: stats.size,
              })
            }
          } catch {
            // Skip inaccessible entries
          }
        }

        return children
      }

      const tree = await buildTree(dirPath)
      return {
        content: [{ type: 'text', text: JSON.stringify(tree, null, 2) }]
      }
    }
  )

  // ─────────────────────────────────────────────────────────────────
  // FILE OPERATIONS
  // ─────────────────────────────────────────────────────────────────

  server.registerTool(
    'move_file',
    {
      description: 'Move or rename files and directories. Fails if destination exists. Both source and destination must be within the workspace.',
      inputSchema: {
        source: z.string().describe('Source path'),
        destination: z.string().describe('Destination path'),
      },
    },
    async ({ source, destination }, { sessionId }) => {
      const backend = await getBackend(sessionId) as FileBasedBackend

      // Verify source exists
      if (!await backend.exists(source)) {
        throw new Error(`Source does not exist: ${source}`)
      }

      // Check if destination exists - fail if it does
      if (await backend.exists(destination)) {
        throw new Error(`Destination already exists: ${destination}`)
      }

      // Ensure destination parent directory exists
      const destDir = path.dirname(destination)
      if (destDir && destDir !== '.') {
        await backend.mkdir(destDir, { recursive: true })
      }

      // Use rename API (matches Node fs.promises)
      // The backend.exists() calls above already validate the paths are within bounds
      await backend.rename(source, destination)
      return {
        content: [{ type: 'text', text: `Moved ${source} to ${destination}` }]
      }
    }
  )

  server.registerTool(
    'search_files',
    {
      description: 'Recursively search for files and directories matching a glob pattern. Patterns match against paths relative to the search directory. Pass sortBy: "mtime" to sort results by modification time (newest first) — useful for surfacing recently-edited files.',
      inputSchema: {
        path: z.string().describe('Starting directory path'),
        pattern: z.string().describe('Glob pattern to match (e.g., "*.ts", "**/*.js", "src/**/*.tsx")'),
        excludePatterns: z.array(z.string()).optional()
          .describe('Patterns to exclude from results'),
        sortBy: z.enum(['path', 'mtime']).optional()
          .describe('Sort order for results. "path" (default) sorts alphabetically by path. "mtime" sorts by modification time, newest first.'),
      },
    },
    async ({ path: searchPath, pattern, excludePatterns: excludePatternsParam, sortBy: sortByParam }, { sessionId }) => {
      const excludePatterns = excludePatternsParam ?? []
      const sortBy = sortByParam ?? 'path'
      const backend = await getBackend(sessionId) as FileBasedBackend
      const results: Array<{ path: string, mtimeMs: number }> = []

      async function searchDir(currentPath: string): Promise<void> {
        const entries = await backend.readdir(currentPath) as string[]

        for (const entry of entries) {
          const fullPath = path.join(currentPath, entry)
          const relativePath = path.relative(searchPath, fullPath)

          const shouldExclude = excludePatterns.some((excludePattern: string) =>
            minimatch(relativePath, excludePattern, { dot: true })
          )
          if (shouldExclude) continue

          let stats
          try {
            stats = await backend.stat(fullPath)
          } catch {
            continue
          }

          if (minimatch(relativePath, pattern, { dot: true })) {
            results.push({ path: fullPath, mtimeMs: stats.mtime.getTime() })
          }

          if (stats.isDirectory()) {
            await searchDir(fullPath)
          }
        }
      }

      await searchDir(searchPath)

      if (sortBy === 'mtime') {
        results.sort((a, b) => b.mtimeMs - a.mtimeMs)
      } else {
        results.sort((a, b) => a.path.localeCompare(b.path))
      }

      const paths = results.map(r => r.path)
      return {
        content: [{ type: 'text', text: paths.length > 0 ? paths.join('\n') : 'No matches found' }]
      }
    }
  )

  server.registerTool(
    'get_file_info',
    {
      description: 'Get detailed metadata: size, timestamps, type, permissions',
      inputSchema: {
        path: z.string().describe('Path to the file or directory'),
      },
    },
    async ({ path: filePath }, { sessionId }) => {
      const backend = await getBackend(sessionId) as FileBasedBackend
      const stats = await backend.stat(filePath)

      const info = {
        path: filePath,
        type: stats.isDirectory() ? 'directory' : stats.isFile() ? 'file' : 'other',
        size: stats.size,
        created: stats.birthtime?.toISOString(),
        modified: stats.mtime.toISOString(),
        accessed: stats.atime.toISOString(),
        mode: stats.mode.toString(8),
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(info, null, 2) }]
      }
    }
  )

}

/**
 * Register exec tool on an MCP server.
 * Should only be called for backends that support command execution (FileBasedBackend).
 * Do NOT call this for MemoryBackend.
 */
export function registerExecTool(server: McpServer, getBackend: BackendGetter): void {
  server.registerTool(
    'exec',
    {
      description: 'Execute a shell command in the workspace directory.',
      inputSchema: {
        command: z.string().describe('Shell command to execute. Set per-command environment variables inline, e.g. FOO=bar cmd.'),
      },
    },
    async ({ command }, { sessionId }) => {
      const backend = await getBackend(sessionId) as FileBasedBackend
      const result = await backend.exec(command)
      return {
        content: [{ type: 'text', text: result as string }]
      }
    }
  )
}

/**
 * Shell-escape a string for safe inclusion in a bash -c command.
 * Wraps in single quotes and escapes existing single quotes via '\''.
 */
function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`
}

/**
 * Register grep tool on an MCP server. Shells out to ripgrep via the backend's
 * exec capability. Should only be called for backends with exec (FileBasedBackend).
 */
export function registerGrepTool(server: McpServer, getBackend: BackendGetter): void {
  server.registerTool(
    'grep',
    {
      description: 'Search file contents with ripgrep (rg). Returns matching file paths, per-file match counts, or match content. Respects .gitignore by default.',
      inputSchema: {
        pattern: z.string().describe('Regex pattern to search for'),
        path: z.string().optional().describe('File or directory to search in. Defaults to the workspace root.'),
        glob: z.string().optional().describe('Glob to filter which files are searched (e.g. "*.ts", "src/**/*.py")'),
        type: z.string().optional().describe('Ripgrep file-type name (e.g. "js", "py", "rust"). See `rg --type-list`.'),
        outputMode: z.enum(['content', 'files_with_matches', 'count']).optional()
          .describe('"files_with_matches" (default) returns matching paths; "count" returns per-file match counts; "content" returns matching lines.'),
        caseInsensitive: z.boolean().optional().describe('Case-insensitive matching (rg -i).'),
        multiline: z.boolean().optional().describe('Allow patterns to match across newlines (rg -U --multiline-dotall).'),
        contextBefore: z.number().int().min(0).optional().describe('Lines of context before each match (rg -B). Use 0 for none. Ignored outside content mode.'),
        contextAfter: z.number().int().min(0).optional().describe('Lines of context after each match (rg -A). Use 0 for none. Ignored outside content mode.'),
        contextAround: z.number().int().min(0).optional().describe('Lines of context on both sides of each match (rg -C). Use 0 for none. Ignored outside content mode. An explicit contextBefore/contextAfter overrides this for that side, exactly as rg does.'),
        lineNumbers: z.boolean().optional().describe('Prefix content-mode output with line numbers (rg -n). Ignored for other output modes.'),
        headLimit: z.number().int().positive().optional().describe('Cap result to the first N output lines (applied after search).'),
      },
    },
    async (args, { sessionId }) => {
      const {
        pattern, path: searchPath, glob, type,
        outputMode: outputModeParam,
        caseInsensitive, multiline,
        contextBefore, contextAfter, contextAround,
        lineNumbers, headLimit,
      } = args

      const outputMode = outputModeParam ?? 'files_with_matches'

      // Models fill every optional field in a schema with a neutral value, so the
      // presence of a context parameter is not a request for context. Resolve the
      // three the way rg itself does — an explicit -B/-A wins over -C for that
      // side — instead of rejecting combinations, and ignore them outside content
      // mode the same way lineNumbers is ignored.
      const before = contextBefore ?? contextAround
      const after = contextAfter ?? contextAround

      const rgArgs: string[] = ['--color=never', '--no-heading', '--with-filename']
      if (caseInsensitive) rgArgs.push('-i')
      if (multiline) rgArgs.push('-U', '--multiline-dotall')

      if (outputMode === 'files_with_matches') rgArgs.push('-l')
      else if (outputMode === 'count') rgArgs.push('-c')
      else if (outputMode === 'content' && lineNumbers) rgArgs.push('-n')

      if (outputMode === 'content') {
        if (before) rgArgs.push('-B', String(before))
        if (after) rgArgs.push('-A', String(after))
      }

      if (glob) rgArgs.push('--glob', glob)
      if (type) rgArgs.push('--type', type)

      rgArgs.push('--', pattern)
      if (searchPath) rgArgs.push(searchPath)

      // `rg` exits 1 when it finds no matches; wrap so that only exit 0 means
      // "found results" and exit 1 means "real rg error". Exit 2 from rg gets
      // remapped to 1 by the wrapper, and its stderr is what exec surfaces.
      const rgCmd = ['rg', ...rgArgs.map(shellEscape)].join(' ')
      const shellCmd = `${rgCmd} || [ $? -eq 1 ]`

      const backend = await getBackend(sessionId) as FileBasedBackend
      let output: string
      try {
        output = await backend.exec(shellCmd) as string
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.includes('exit code 127') || /rg:\s+(command\s+)?not found/i.test(msg)) {
          throw new Error('grep requires ripgrep (rg) to be installed. Install via `apt install ripgrep`, `brew install ripgrep`, or use the agentbe-daemon Docker image.', { cause: err })
        }
        throw err
      }

      if (output === '') {
        return { content: [{ type: 'text', text: 'No matches found' }] }
      }

      const lines = output.split('\n')
      if (headLimit != null && lines.length > headLimit) {
        const kept = lines.slice(0, headLimit)
        kept.push(`[output truncated to first ${headLimit} lines; ${lines.length - headLimit} more hidden]`)
        return { content: [{ type: 'text', text: kept.join('\n') }] }
      }

      return { content: [{ type: 'text', text: output }] }
    }
  )
}
