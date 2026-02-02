import { backendManager } from '@/lib/backend'
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
    const content = await backend.readFile(path)

    const filename = path.split('/').pop() || 'download.txt'

    return new NextResponse(content, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (error) {
    console.error('Error downloading file:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to download file'
      },
      { status: 500 }
    )
  }
}
