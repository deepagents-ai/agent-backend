import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { activeStreams } from '@/lib/stream-storage'

export async function POST(req: NextRequest) {
  try {
    const { content, sessionId } = await req.json()

    if (!content || !sessionId) {
      return NextResponse.json(
        { error: 'content and sessionId required' },
        { status: 400 }
      )
    }

    // Generate stream ID
    const streamId = uuidv4()

    // Store stream metadata
    activeStreams.set(streamId, {
      sessionId,
      content,
    })

    // Clean up after 5 minutes
    setTimeout(() => activeStreams.delete(streamId), 5 * 60 * 1000)

    return NextResponse.json({
      streamId,
      streamUrl: `/api/chat/stream?id=${streamId}`
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process message' },
      { status: 500 }
    )
  }
}
