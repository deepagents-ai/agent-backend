/**
 * In-memory storage for active SSE streams
 * Maps stream IDs to their associated data
 *
 * Uses globalThis to persist across Next.js Fast Refresh in development
 */

type StreamData = {
  sessionId: string
  content: string
}

declare global {
  var __activeStreams: Map<string, StreamData> | undefined
}

export const activeStreams: Map<string, StreamData> =
  globalThis.__activeStreams ||
  (globalThis.__activeStreams = new Map<string, StreamData>())
