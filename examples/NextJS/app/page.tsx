'use client'

import { useState, useEffect } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { BackendProvider } from './lib/backend-context'
import Header from './components/Header'
import FileExplorer from './components/FileExplorer'
import Chat from './components/Chat'
import Editor from './components/Editor'

export default function Home() {
  const [sessionId, setSessionId] = useState<string>('')
  const [selectedFile, setSelectedFile] = useState<string | null>(null)

  useEffect(() => {
    // Generate session ID on mount
    setSessionId(uuidv4())
  }, [])

  if (!sessionId) {
    return (
      <div className="h-screen flex items-center justify-center bg-bg-app">
        <div className="w-8 h-8 border-2 border-primary-600/30 border-t-primary-600 rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <BackendProvider>
      <div className="h-screen flex flex-col bg-bg-app">
        <Header sessionId={sessionId} />

        <div className="flex-1 flex overflow-hidden">
          <FileExplorer
            sessionId={sessionId}
            onFileSelect={setSelectedFile}
            selectedFile={selectedFile}
          />

          <Chat sessionId={sessionId} />

          <Editor
            sessionId={sessionId}
            selectedFile={selectedFile}
          />
        </div>
      </div>
    </BackendProvider>
  )
}
