import { NextResponse } from 'next/server'
import { backendConfig } from '@/lib/backend-config'
import { backendManager } from '@/lib/backend'

export async function GET() {
  const config = backendConfig.getConfig()
  return NextResponse.json(config)
}

export async function POST(req: Request) {
  try {
    const config = await req.json()

    // Disconnect current backend before switching
    await backendManager.disconnect()

    // Update config
    backendConfig.setConfig(config)

    // Force backend reinitialization on next request
    await backendManager.switchBackend(config.type)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to update backend config:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to update config',
      },
      { status: 500 }
    )
  }
}
