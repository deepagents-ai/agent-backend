'use client'

import { useState, useEffect } from 'react'
import { Zap } from 'lucide-react'
import BackendSettings from './BackendSettings'

interface HeaderProps {
  sessionId: string
}

export default function Header({ sessionId }: HeaderProps) {
  const [backendType, setBackendType] = useState<'local' | 'remote'>('local')

  useEffect(() => {
    // Load current backend type
    fetch('/api/backend-config')
      .then(res => res.json())
      .then(config => setBackendType(config.type))
      .catch(err => console.error('Failed to load backend type:', err))
  }, [])

  return (
    <header className="h-[60px] border-b border-border-subtle bg-bg-surface flex items-center justify-between px-6">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-600 to-accent-purple flex items-center justify-center">
          <Zap className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Agent Backend Demo</h1>
          <p className="text-xs text-text-tertiary">Professional AI Development Platform</p>
        </div>
      </div>

      <div className="flex items-center gap-4">
        {/* Backend Type Indicator */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-bg-elevated">
          <div className="w-2 h-2 rounded-full bg-accent-green" />
          <span className="text-sm text-text-secondary capitalize">{backendType}</span>
        </div>

        {/* Backend Settings */}
        <BackendSettings />

        <div className="text-xs text-text-tertiary">
          Session: {sessionId.slice(0, 8)}
        </div>
      </div>
    </header>
  )
}
