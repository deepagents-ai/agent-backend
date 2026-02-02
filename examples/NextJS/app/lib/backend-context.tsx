'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'

type BackendType = 'local' | 'remote'

interface BackendContextType {
  backendType: BackendType
  switchBackend: (type: BackendType) => Promise<void>
  isConnected: boolean
  isSwitching: boolean
  error: string | null
}

const BackendContext = createContext<BackendContextType | undefined>(undefined)

export function BackendProvider({ children }: { children: ReactNode }) {
  const [backendType, setBackendType] = useState<BackendType>(
    (process.env.NEXT_PUBLIC_BACKEND_TYPE as BackendType) || 'local'
  )
  const [isConnected, setIsConnected] = useState(false)
  const [isSwitching, setIsSwitching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Test connection on mount and when backend type changes
  useEffect(() => {
    testConnection()
  }, [backendType])

  async function testConnection() {
    try {
      const response = await fetch('/api/backend/status')
      const data = await response.json()
      setIsConnected(data.connected)
      setError(null)
    } catch (err) {
      setIsConnected(false)
      setError(err instanceof Error ? err.message : 'Connection failed')
    }
  }

  async function switchBackend(type: BackendType) {
    setIsSwitching(true)
    setError(null)

    try {
      const response = await fetch('/api/backend/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type })
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to switch backend')
      }

      setBackendType(type)

      // Force page reload to reset all sessions and connections
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to switch backend')
      throw err
    } finally {
      setIsSwitching(false)
    }
  }

  return (
    <BackendContext.Provider
      value={{
        backendType,
        switchBackend,
        isConnected,
        isSwitching,
        error
      }}
    >
      {children}
    </BackendContext.Provider>
  )
}

export function useBackend() {
  const context = useContext(BackendContext)
  if (!context) {
    throw new Error('useBackend must be used within BackendProvider')
  }
  return context
}
