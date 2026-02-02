import { backendManager } from '@/lib/backend'
import type { FileWriteRequest, FileWriteResponse } from '@/lib/types'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const body: FileWriteRequest = await req.json()
    const { sessionId, path, content } = body

    if (!sessionId || !path || content === undefined) {
      return NextResponse.json(
        { error: 'sessionId, path, and content required' },
        { status: 400 }
      )
    }

    const backend = await backendManager.getBackend()
    await backend.writeFile(path, content)

    const response: FileWriteResponse = {
      success: true,
      path,
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Error writing file:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to write file'
      },
      { status: 500 }
    )
  }
}
