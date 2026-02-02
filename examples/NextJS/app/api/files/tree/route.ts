import { backendManager } from '@/lib/backend'
import type { FileItem, FileTreeResponse } from '@/lib/types'
import { FileBasedBackend } from 'agent-backend'
import { NextRequest, NextResponse } from 'next/server'

async function buildFileTree(backend: FileBasedBackend, dirPath: string): Promise<FileItem[]> {
  // readdir returns just filenames (string[])
  const filenames = await backend.readdir(dirPath)
  const items: FileItem[] = []

  for (const filename of filenames) {
    const fullPath = dirPath === '.' ? filename : `${dirPath}/${filename}`

    try {
      // Use stat to get file metadata
      const stats = await backend.stat(fullPath)

      const item: FileItem = {
        name: filename,
        path: fullPath,
        type: stats.isDirectory() ? 'directory' : 'file',
        size: stats.size,
        mtime: stats.mtime.toISOString(),
      }

      if (stats.isDirectory()) {
        try {
          item.children = await buildFileTree(backend, fullPath)
        } catch (error) {
          // Skip directories we can't read
          item.children = []
        }
      }

      items.push(item)
    } catch (error) {
      // Skip files we can't stat
      console.warn(`Failed to stat ${fullPath}:`, error)
    }
  }

  return items.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'directory' ? -1 : 1
    }
    return a.name.localeCompare(b.name)
  })
}

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId')

  if (!sessionId) {
    return NextResponse.json(
      { error: 'sessionId required' },
      { status: 400 }
    )
  }

  try {
    const backend = await backendManager.getBackend()
    const files = await buildFileTree(backend, '.')

    const response: FileTreeResponse = { files }
    return NextResponse.json(response)
  } catch (error) {
    console.error('Error listing files:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to list files'
      },
      { status: 500 }
    )
  }
}
