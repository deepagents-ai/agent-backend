import { NextRequest, NextResponse } from 'next/server'
import { backendManager } from '@/lib/backend'

export async function POST(req: NextRequest) {
  try {
    const { type } = await req.json()

    if (type !== 'local' && type !== 'remote') {
      return NextResponse.json(
        { error: 'Invalid backend type. Must be "local" or "remote".' },
        { status: 400 }
      )
    }

    // Validate remote configuration if switching to remote
    if (type === 'remote') {
      const requiredVars = [
        'REMOTE_VM_HOST',
        'REMOTE_VM_USER',
        'REMOTE_MCP_URL'
      ]

      const missingVars = requiredVars.filter(v => !process.env[v])

      if (missingVars.length > 0) {
        return NextResponse.json(
          {
            error: `Missing required environment variables for remote backend: ${missingVars.join(', ')}`,
            missingVars
          },
          { status: 400 }
        )
      }

      if (!process.env.REMOTE_VM_PASSWORD && !process.env.REMOTE_VM_PRIVATE_KEY) {
        return NextResponse.json(
          {
            error: 'Remote backend requires either REMOTE_VM_PASSWORD or REMOTE_VM_PRIVATE_KEY'
          },
          { status: 400 }
        )
      }
    }

    await backendManager.switchBackend(type)

    return NextResponse.json({
      success: true,
      type
    })
  } catch (error) {
    console.error('Error switching backend:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to switch backend'
      },
      { status: 500 }
    )
  }
}
