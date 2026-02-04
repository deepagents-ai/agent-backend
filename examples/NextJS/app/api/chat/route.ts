import { getMCPClientForSession } from '@/lib/mcp-client'
import { openrouter } from '@openrouter/ai-sdk-provider'
import { convertToModelMessages, streamText } from 'ai'

export async function POST(req: Request) {
  const { id, messages, sessionId } = await req.json()

  // Get MCP client (cached per session, cleared on backend config change)
  const mcpClient = await getMCPClientForSession(sessionId)
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

  // Convert UI messages to model messages
  const modelMessages = await convertToModelMessages(messages, { tools })

  // Stream AI response with tools
  const result = streamText({
    model: openrouter('anthropic/claude-4.5-sonnet'),
    messages: modelMessages,
    tools,
  })

  return result.toUIMessageStreamResponse()
}
