import { NextRequest } from 'next/server'
import { openrouter } from '@openrouter/ai-sdk-provider'
import { streamText } from 'ai'
import { createMCPClient } from '@/lib/mcp-client'
import { activeStreams } from '@/lib/stream-storage'

// MCP client cache (same as before)
const mcpClients = new Map<string, any>()

async function getMCPClient(sessionId: string) {
  if (mcpClients.has(sessionId)) {
    return mcpClients.get(sessionId)
  }

  const client = await createMCPClient()
  mcpClients.set(sessionId, client)
  return client
}

export async function GET(req: NextRequest) {
  const streamId = req.nextUrl.searchParams.get('id')

  if (!streamId) {
    return new Response('Stream ID required', { status: 400 })
  }

  const streamData = activeStreams.get(streamId)
  if (!streamData) {
    return new Response('Stream not found', { status: 404 })
  }

  const { sessionId, content } = streamData

  // Create SSE stream
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Send SSE helper function
        const sendEvent = (event: string, data: any) => {
          const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
          controller.enqueue(new TextEncoder().encode(message))
        }

        // Send connected event
        sendEvent('connected', { sessionId })

        // Get MCP client and tools
        const mcpClient = await getMCPClient(sessionId)
        const toolsResult = await mcpClient.listTools()
        const tools = toolsResult.tools.reduce((acc: any, tool: any) => {
          acc[tool.name] = {
            description: tool.description,
            parameters: tool.inputSchema,
            execute: async (params: any) => {
              const result = await mcpClient.callTool({
                name: tool.name,
                arguments: params,
              })
              return result.content
            },
          }
          return acc
        }, {})

        // Send message_start
        sendEvent('message_start', {})

        // Stream AI response
        const result = await streamText({
          model: openrouter('anthropic/claude-3.5-sonnet'),
          messages: [{ role: 'user', content }],
          tools,
        })

        // Stream text chunks
        for await (const part of result.fullStream) {
          if (part.type === 'text-delta') {
            sendEvent('text_delta', { text: part.text })
          } else if (part.type === 'tool-call') {
            sendEvent('tool_start', {
              name: part.toolName,
              params: 'input' in part ? part.input : {},
            })
          } else if (part.type === 'tool-result') {
            sendEvent('tool_result', {
              name: part.toolName,
              output: JSON.stringify('output' in part ? part.output : part),
              duration_ms: 0,
            })
          } else if (part.type === 'finish') {
            sendEvent('message_end', { id: part.finishReason || 'complete' })
          }
        }

        controller.close()
      } catch (error) {
        const message = `event: error\ndata: ${JSON.stringify({
          message: error instanceof Error ? error.message : 'Unknown error'
        })}\n\n`
        controller.enqueue(new TextEncoder().encode(message))
        controller.close()
      } finally {
        activeStreams.delete(streamId)
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
