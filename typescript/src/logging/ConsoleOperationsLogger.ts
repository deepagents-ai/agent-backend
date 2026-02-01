import type { LoggingMode, OperationLogEntry, OperationsLogger } from './types.js'

/**
 * Console-based operations logger
 * Logs workspace operations to the console with formatted output
 */
export class ConsoleOperationsLogger implements OperationsLogger {
  constructor(public readonly mode: LoggingMode = 'standard') {}

  log(entry: OperationLogEntry): void {
    const timestamp = entry.timestamp.toISOString()
    const prefix = `[${timestamp}] [${entry.userId}/${entry.workspaceName}]`
    const status = entry.success ? '\u2713' : '\u2717'
    const duration = `${entry.durationMs}ms`

    // Format the main log line
    const mainLine = `${prefix} ${status} ${entry.operation}: ${entry.command} (${duration})`

    if (entry.success) {
      // eslint-disable-next-line no-console
      console.log(mainLine)
    } else {
      // eslint-disable-next-line no-console
      console.error(mainLine)
    }

    // Log stdout/stderr for exec operations if present
    if (entry.operation === 'exec') {
      if (entry.stdout) {
        // eslint-disable-next-line no-console
        console.log(`  stdout: ${this.truncate(entry.stdout, 200)}`)
      }
      if (entry.stderr) {
        // eslint-disable-next-line no-console
        console.error(`  stderr: ${this.truncate(entry.stderr, 200)}`)
      }
    }

    // Log error message if operation failed
    if (!entry.success && entry.error) {
      // eslint-disable-next-line no-console
      console.error(`  error: ${entry.error}`)
    }
  }

  /**
   * Truncate a string to a maximum length
   */
  private truncate(str: string, maxLength: number): string {
    const singleLine = str.replace(/\n/g, '\\n')
    if (singleLine.length <= maxLength) return singleLine
    return `${singleLine.substring(0, maxLength)}...`
  }
}
