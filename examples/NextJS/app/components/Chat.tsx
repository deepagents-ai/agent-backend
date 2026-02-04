'use client'

import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Bot, ChevronDown, ChevronUp, Send, User } from 'lucide-react'

interface ChatProps {
  sessionId: string
}

export default function Chat({ sessionId }: ChatProps) {
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set())
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/chat',
        body: { sessionId },
      }),
    [sessionId]
  )

  const { messages, sendMessage, status } = useChat({
    transport,
  })

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const isLoading = status === 'submitted' || status === 'streaming'
  const isButtonDisabled = !input.trim() || isLoading

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return

    await sendMessage({ text: input })
    setInput('')
  }

  const toggleToolExpand = (toolKey: string) => {
    setExpandedTools(prev => {
      const next = new Set(prev)
      if (next.has(toolKey)) {
        next.delete(toolKey)
      } else {
        next.add(toolKey)
      }
      return next
    })
  }

  return (
    <div className="flex-1 flex flex-col bg-bg-app">
      <div className="flex-1 overflow-y-auto scrollbar-thin p-6 space-y-4">
        {messages.length === 0 && !isLoading && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary-600 to-accent-purple flex items-center justify-center mb-4">
              <Bot className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-xl font-semibold text-text-primary mb-2">Welcome to Agent Backend</h2>
            <p className="text-text-secondary max-w-md">
              Ask me to create files, run commands, or help with your project. I have direct access to your workspace.
            </p>
          </div>
        )}

        {messages.map((message) => {
          // Extract text parts
          const textParts = message.parts.filter((p: any) => p.type === 'text')
          const textContent = textParts.map((p: any) => p.text).join('')

          // Extract tool parts
          const toolParts = message.parts.filter(
            (p: any) => p.type.startsWith('tool-') || p.type === 'dynamic-tool'
          )

          return (
            <div
              key={message.id}
              className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {message.role === 'assistant' && (
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-600 to-accent-purple flex items-center justify-center flex-shrink-0">
                  <Bot className="w-5 h-5 text-white" />
                </div>
              )}

              <div className={`max-w-[70%] ${message.role === 'user' ? 'order-first' : ''}`}>
                {textContent && (
                  <div
                    className={`rounded-lg px-4 py-3 ${
                      message.role === 'user'
                        ? 'bg-gradient-to-r from-primary-600 to-primary-700 text-white'
                        : 'bg-bg-surface text-text-primary'
                    }`}
                  >
                    <div className="prose prose-invert prose-sm max-w-none">
                      <ReactMarkdown>{textContent}</ReactMarkdown>
                    </div>
                  </div>
                )}

                {toolParts.length > 0 && (
                  <div className="mt-2 space-y-2">
                    {toolParts.map((tool: any, index: number) => {
                      const toolKey = `${message.id}-${index}`
                      const toolName = tool.type === 'dynamic-tool' ? tool.toolName : tool.type.replace('tool-', '')
                      const hasOutput = tool.state === 'output-available'
                      const isStreaming = tool.state === 'input-streaming' || tool.state === 'output-streaming'

                      return (
                        <div key={toolKey} className="bg-bg-surface rounded-lg border border-border-subtle overflow-hidden">
                          <button
                            onClick={() => toggleToolExpand(toolKey)}
                            className="w-full flex items-center justify-between p-3 hover:bg-bg-elevated transition-colors"
                          >
                            <div className="flex items-center gap-2">
                              <div
                                className={`w-2 h-2 rounded-full ${
                                  hasOutput ? 'bg-accent-green' : isStreaming ? 'bg-accent-amber animate-pulse' : 'bg-accent-blue'
                                }`}
                              />
                              <span className="text-sm font-medium text-text-primary">{toolName}</span>
                              {hasOutput && <span className="text-xs text-text-tertiary">(completed)</span>}
                              {isStreaming && <span className="text-xs text-text-tertiary">(streaming)</span>}
                            </div>
                            {expandedTools.has(toolKey) ? (
                              <ChevronUp className="w-4 h-4 text-text-tertiary" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-text-tertiary" />
                            )}
                          </button>

                          {expandedTools.has(toolKey) && (
                            <div className="border-t border-border-subtle p-3 space-y-2 overflow-hidden">
                              {tool.input && (
                                <div className="min-w-0">
                                  <p className="text-xs font-medium text-text-tertiary mb-1">Input:</p>
                                  <pre className="text-xs bg-bg-app rounded p-2 overflow-x-auto text-text-secondary whitespace-pre-wrap break-all">
                                    {JSON.stringify(tool.input, null, 2)}
                                  </pre>
                                </div>
                              )}
                              {tool.output && (
                                <div className="min-w-0">
                                  <p className="text-xs font-medium text-text-tertiary mb-1">Output:</p>
                                  <pre className="text-xs bg-bg-app rounded p-2 overflow-x-auto text-text-secondary whitespace-pre-wrap break-all max-h-64">
                                    {JSON.stringify(tool.output, null, 2)}
                                  </pre>
                                </div>
                              )}
                              {tool.errorText && (
                                <div className="min-w-0">
                                  <p className="text-xs font-medium text-text-red mb-1">Error:</p>
                                  <pre className="text-xs bg-bg-app rounded p-2 overflow-x-auto text-text-red whitespace-pre-wrap break-all">
                                    {tool.errorText}
                                  </pre>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {message.role === 'user' && (
                <div className="w-8 h-8 rounded-lg bg-bg-elevated flex items-center justify-center flex-shrink-0">
                  <User className="w-5 h-5 text-text-secondary" />
                </div>
              )}
            </div>
          )
        })}

        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-border-subtle p-4">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask me to create files, run commands..."
            disabled={isLoading}
            className="flex-1 px-4 py-3 bg-bg-surface border border-border-subtle rounded-lg text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-primary-600 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isButtonDisabled}
            className="px-6 py-3 bg-primary-600 hover:bg-primary-700 disabled:bg-bg-elevated disabled:text-text-tertiary rounded-lg text-white font-medium transition-colors flex items-center gap-2"
          >
            <Send className="w-4 h-4" />
            Send
          </button>
        </form>
      </div>
    </div>
  )
}
