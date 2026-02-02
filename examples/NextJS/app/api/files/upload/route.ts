import { backendManager } from '@/lib/backend'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File
    const sessionId = formData.get('sessionId') as string

    if (!file || !sessionId) {
      return NextResponse.json(
        { error: 'file and sessionId required' },
        { status: 400 }
      )
    }

    const content = await file.text()
    const path = file.name

    const backend = await backendManager.getBackend()
    await backend.write(path, content)

    return NextResponse.json({ success: true, path })
  } catch (error) {
    console.error('Error uploading file:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to upload file'
      },
      { status: 500 }
    )
  }
}
