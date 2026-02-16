/**
 * Interactive CLI chat harness — handles readline, streaming, and message history.
 */

import { openrouter } from '@openrouter/ai-sdk-provider'
import { stepCountIs, streamText, type ModelMessage } from 'ai'
import * as readline from 'node:readline'

interface ChatOptions {
  model: string
  tools: Record<string, any>
}

export async function runChat({ model, tools }: ChatOptions) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const ask = (prompt: string): Promise<string> =>
    new Promise((resolve) => rl.question(prompt, resolve))

  const messages: ModelMessage[] = []

  console.log(`Type "exit" to quit.\n`)

  try {
    while (true) {
      const input = await ask('you> ')
      if (input.trim().toLowerCase() === 'exit') break
      if (!input.trim()) continue

      messages.push({ role: 'user', content: input })
      process.stdout.write('\n...\r')

      const result = streamText({
        model: openrouter(model),
        messages,
        tools,
        stopWhen: stepCountIs(15),
      })

      let hasOutput = false
      for await (const part of result.fullStream) {
        switch (part.type) {
          case 'text-delta':
            if (!hasOutput) {
              process.stdout.write('\x1b[2K\rassistant> ')
              hasOutput = true
            }
            process.stdout.write(part.text)
            break
          case 'tool-call':
            if (!hasOutput) {
              process.stdout.write('\x1b[2K\r')
              hasOutput = true
            }
            process.stdout.write(`  [${part.toolName}] ${JSON.stringify(part.input).slice(0, 120)}\n`)
            break
          case 'tool-result': {
            const text = typeof part.output === 'string' ? part.output : JSON.stringify(part.output)
            if (text.length > 200) {
              process.stdout.write(`\n  => ${text.slice(0, 200)}...`)
            } else {
              process.stdout.write(`\n  => ${text}`)
            }
            break
          }
        }
      }

      const response = await result.response
      messages.push(...response.messages)
      process.stdout.write('\n\n')
    }
  } finally {
    rl.close()
  }
}
