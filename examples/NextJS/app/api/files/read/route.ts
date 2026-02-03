import { backendManager } from '@/lib/backend'
import type { FileReadResponse } from '@/lib/types'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId')
  const path = req.nextUrl.searchParams.get('path')

  if (!sessionId || !path) {
    return NextResponse.json(
      { error: 'sessionId and path required' },
      { status: 400 }
    )
  }

  try {
    const backend = await backendManager.getBackend()
    const rawContent = await backend.readFile(path)

    // Convert Buffer to string if needed
    const content = Buffer.isBuffer(rawContent) ? rawContent.toString('utf-8') : rawContent

    // Get file size
    const stat = await backend.stat(path)

    const response: FileReadResponse = {
      content,
      path,
      size: stat.size,
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Error reading file:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to read file'
      },
      { status: 500 }
    )
  }
}
