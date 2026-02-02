import { NextResponse } from 'next/server'
import { backendManager } from '@/lib/backend'

export async function GET() {
  try {
    const backend = await backendManager.getBackend()
    const type = backendManager.getCurrentType()

    return NextResponse.json({
      connected: backend.connected,
      type,
      rootDir: 'rootDir' in backend ? backend.rootDir : undefined
    })
  } catch (error) {
    return NextResponse.json(
      {
        connected: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
