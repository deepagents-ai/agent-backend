'use client'

import { useState, useEffect } from 'react'
import { Activity, Zap, RefreshCw } from 'lucide-react'
import { useBackend } from '@/lib/backend-context'

interface HeaderProps {
  sessionId: string
}

export default function Header({ sessionId }: HeaderProps) {
  const { backendType, switchBackend, isConnected, isSwitching, error } = useBackend()
  const [showSwitchConfirm, setShowSwitchConfirm] = useState(false)

  async function handleSwitch() {
    const newType = backendType === 'local' ? 'remote' : 'local'

    try {
      await switchBackend(newType)
    } catch (err) {
      console.error('Failed to switch backend:', err)
      // Error is already set in context
    }
  }

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
        {/* Backend Status */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-bg-elevated">
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-accent-green' : 'bg-red-500'}`} />
          <span className="text-sm text-text-secondary">
            {isConnected ? 'Connected' : 'Disconnected'} · {backendType}
          </span>
        </div>

        {/* Backend Switcher */}
        <div className="relative">
          <button
            onClick={() => setShowSwitchConfirm(!showSwitchConfirm)}
            disabled={isSwitching}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-bg-elevated hover:bg-bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Switch backend"
          >
            <RefreshCw className={`w-4 h-4 text-text-secondary ${isSwitching ? 'animate-spin' : ''}`} />
            <span className="text-sm text-text-secondary">Switch</span>
          </button>

          {/* Confirmation Dropdown */}
          {showSwitchConfirm && (
            <div className="absolute right-0 mt-2 w-72 bg-bg-surface border border-border-subtle rounded-lg shadow-lg z-50 p-4">
              <h3 className="text-sm font-semibold text-text-primary mb-2">
                Switch to {backendType === 'local' ? 'Remote' : 'Local'} Backend?
              </h3>
              <p className="text-xs text-text-secondary mb-3">
                This will reload the page and reset all active sessions.
              </p>
              {error && (
                <div className="text-xs text-red-500 mb-3 p-2 bg-red-500/10 rounded">
                  {error}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={handleSwitch}
                  disabled={isSwitching}
                  className="flex-1 px-3 py-1.5 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded transition-colors disabled:opacity-50"
                >
                  {isSwitching ? 'Switching...' : 'Confirm'}
                </button>
                <button
                  onClick={() => setShowSwitchConfirm(false)}
                  className="flex-1 px-3 py-1.5 text-sm bg-bg-elevated hover:bg-bg-muted text-text-secondary rounded transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="text-xs text-text-tertiary">
          Session: {sessionId.slice(0, 8)}
        </div>
      </div>
    </header>
  )
}
