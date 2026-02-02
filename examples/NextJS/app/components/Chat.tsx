'use client'

import { useState, useEffect, useRef } from 'react'
import { Send, Bot, User, ChevronDown, ChevronUp } from 'lucide-react'
import ReactMarkdown from 'react-markdown'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls?: ToolCall[]
}

interface ToolCall {
  name: string
  params: Record<string, unknown>
  output?: string
  duration_ms?: number
}

interface ChatProps {
  sessionId: string
}

export default function Chat({ sessionId }: ChatProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isConnected, setIsConnected] = useState(false)
  const [isTyping, setIsTyping] = useState(false)
  const [currentMessage, setCurrentMessage] = useState('')
  const [currentTools, setCurrentTools] = useState<ToolCall[]>([])
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set())
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const eventSourceRef = useRef<EventSource | null>(null)

  useEffect(() => {
    // No persistent connection needed for HTTP + SSE
    // Each message will create its own POST + SSE connection
    setIsConnected(true)
  }, [sessionId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, currentMessage])

  const handleSend = async () => {
    if (!input.trim() || isTyping) return

    const messageContent = input
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: messageContent,
    }

    setMessages(prev => [...prev, userMessage])
    setInput('')
    setIsTyping(true)
    setCurrentMessage('')
    setCurrentTools([])

    // Track accumulated message content within this request
    let accumulatedMessage = ''
    let accumulatedTools: ToolCall[] = []

    try {
      // 1. POST message to initiate stream
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: messageContent,
          sessionId,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to send message')
      }

      const { streamUrl } = await response.json()

      // 2. Connect to SSE stream
      const eventSource = new EventSource(streamUrl)
      eventSourceRef.current = eventSource

      eventSource.addEventListener('connected', () => {
        console.log('[Chat] SSE connected')
      })

      eventSource.addEventListener('message_start', () => {
        setIsTyping(true)
        setCurrentMessage('')
        setCurrentTools([])
        accumulatedMessage = ''
        accumulatedTools = []
      })

      eventSource.addEventListener('text_delta', (e) => {
        const data = JSON.parse(e.data)
        accumulatedMessage += data.text
        setCurrentMessage(accumulatedMessage)
      })

      eventSource.addEventListener('tool_start', (e) => {
        const data = JSON.parse(e.data)
        const newTool = {
          name: data.name,
          params: data.params,
        }
        accumulatedTools.push(newTool)
        setCurrentTools([...accumulatedTools])
      })

      eventSource.addEventListener('tool_result', (e) => {
        const data = JSON.parse(e.data)
        accumulatedTools = accumulatedTools.map(tool =>
          tool.name === data.name
            ? { ...tool, output: data.output, duration_ms: data.duration_ms }
            : tool
        )
        setCurrentTools([...accumulatedTools])
      })

      eventSource.addEventListener('message_end', (e) => {
        const data = JSON.parse(e.data)
        setIsTyping(false)
        setMessages(prev => [...prev, {
          id: data.id,
          role: 'assistant',
          content: accumulatedMessage,
          toolCalls: accumulatedTools.length > 0 ? accumulatedTools : undefined,
        }])
        setCurrentMessage('')
        setCurrentTools([])
        eventSource.close()
      })

      eventSource.addEventListener('error', () => {
        console.error('[Chat] SSE error')
        setIsTyping(false)
        eventSource.close()
      })

    } catch (error) {
      console.error('[Chat] Failed to send message:', error)
      setIsTyping(false)
    }
  }

  const toggleToolExpand = (key: string) => {
    setExpandedTools(prev => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  return (
    <div className="flex-1 flex flex-col bg-bg-app">
      <div className="flex-1 overflow-y-auto scrollbar-thin p-6 space-y-4">
        {messages.length === 0 && !isTyping && (
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

        {messages.map((message) => (
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
              <div
                className={`rounded-lg px-4 py-3 ${
                  message.role === 'user'
                    ? 'bg-gradient-to-r from-primary-600 to-primary-700 text-white'
                    : 'bg-bg-surface text-text-primary'
                }`}
              >
                <div className="prose prose-invert prose-sm max-w-none">
                  <ReactMarkdown>
                    {message.content}
                  </ReactMarkdown>
                </div>
              </div>

              {message.toolCalls && message.toolCalls.length > 0 && (
                <div className="mt-2 space-y-2">
                  {message.toolCalls.map((tool, index) => {
                    const toolKey = `${message.id}-${index}`
                    return (
                      <div key={toolKey} className="bg-bg-surface rounded-lg border border-border-subtle overflow-hidden">
                        <button
                          onClick={() => toggleToolExpand(toolKey)}
                          className="w-full flex items-center justify-between p-3 hover:bg-bg-elevated transition-colors"
                        >
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-accent-green" />
                            <span className="text-sm font-medium text-text-primary">{tool.name}</span>
                            {tool.duration_ms !== undefined && (
                              <span className="text-xs text-text-tertiary">({tool.duration_ms}ms)</span>
                            )}
                          </div>
                          {expandedTools.has(toolKey) ? (
                            <ChevronUp className="w-4 h-4 text-text-tertiary" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-text-tertiary" />
                          )}
                        </button>

                        {expandedTools.has(toolKey) && (
                        <div className="border-t border-border-subtle p-3 space-y-2">
                          <div>
                            <p className="text-xs font-medium text-text-tertiary mb-1">Parameters:</p>
                            <pre className="text-xs bg-bg-app rounded p-2 overflow-x-auto text-text-secondary">
                              {JSON.stringify(tool.params, null, 2)}
                            </pre>
                          </div>
                          {tool.output && (
                            <div>
                              <p className="text-xs font-medium text-text-tertiary mb-1">Output:</p>
                              <pre className="text-xs bg-bg-app rounded p-2 overflow-x-auto text-text-secondary">
                                {tool.output}
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
        ))}

        {isTyping && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-600 to-accent-purple flex items-center justify-center flex-shrink-0">
              <Bot className="w-5 h-5 text-white" />
            </div>
            <div className="bg-bg-surface rounded-lg px-4 py-3">
              {currentMessage ? (
                <div className="prose prose-invert prose-sm max-w-none">
                  <ReactMarkdown>
                    {currentMessage}
                  </ReactMarkdown>
                </div>
              ) : (
                <div className="flex gap-1">
                  <div className="w-2 h-2 rounded-full bg-text-tertiary animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-2 h-2 rounded-full bg-text-tertiary animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-2 h-2 rounded-full bg-text-tertiary animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              )}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-border-subtle p-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder="Ask me to create files, run commands..."
            disabled={isTyping}
            className="flex-1 px-4 py-3 bg-bg-surface border border-border-subtle rounded-lg text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-primary-600 disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isTyping}
            className="px-6 py-3 bg-primary-600 hover:bg-primary-700 disabled:bg-bg-elevated disabled:text-text-tertiary rounded-lg text-white font-medium transition-colors flex items-center gap-2"
          >
            <Send className="w-4 h-4" />
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
