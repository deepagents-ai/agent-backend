// WebSocket message types
export type ClientMessage = {
  type: 'user_message'
  content: string
  sessionId: string
}

export type ServerMessage =
  | { type: 'connected'; sessionId: string }
  | { type: 'message_start' }
  | { type: 'text_delta'; text: string }
  | { type: 'tool_start'; name: string; params: Record<string, unknown> }
  | { type: 'tool_result'; name: string; output: string; duration_ms: number }
  | { type: 'message_end'; id: string }
  | { type: 'error'; message: string }
  | { type: 'file_updated'; path: string }

// File system types
export interface FileItem {
  name: string
  path: string
  type: 'file' | 'directory'
  size?: number
  mtime?: string  // ISO 8601 date string
  children?: FileItem[]
}

export interface FileTreeResponse {
  files: FileItem[]
}

export interface FileReadResponse {
  content: string
  path: string
  size: number
}

export interface FileWriteRequest {
  sessionId: string
  path: string
  content: string
}

export interface FileWriteResponse {
  success: boolean
  path: string
}
