'use client'

import { useState, useEffect, useCallback } from 'react'
import { Search, Upload, RefreshCw, File, Folder, Download } from 'lucide-react'
import type { FileItem } from '@/lib/types'

interface FileExplorerProps {
  sessionId: string
  onFileSelect: (path: string) => void
  selectedFile: string | null
}

export default function FileExplorer({ sessionId, onFileSelect, selectedFile }: FileExplorerProps) {
  const [files, setFiles] = useState<FileItem[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())

  const loadFiles = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/files/tree?sessionId=${sessionId}`)
      const data = await response.json()
      setFiles(data.files || [])
    } catch (error) {
      console.error('Failed to load files:', error)
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    loadFiles()
  }, [loadFiles])

  const handleFileClick = (path: string, type: 'file' | 'directory') => {
    if (type === 'directory') {
      setExpandedDirs(prev => {
        const next = new Set(prev)
        if (next.has(path)) {
          next.delete(path)
        } else {
          next.add(path)
        }
        return next
      })
    } else {
      onFileSelect(path)
    }
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const formData = new FormData()
    formData.append('file', file)
    formData.append('sessionId', sessionId)

    try {
      await fetch('/api/files/upload', {
        method: 'POST',
        body: formData,
      })
      loadFiles()
    } catch (error) {
      console.error('Failed to upload file:', error)
    }
  }

  const handleDownload = async (path: string) => {
    try {
      const response = await fetch(`/api/files/download?sessionId=${sessionId}&path=${encodeURIComponent(path)}`)
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = path.split('/').pop() || 'download.txt'
      a.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Failed to download file:', error)
    }
  }

  const filterFiles = (items: FileItem[], query: string): FileItem[] => {
    if (!query) return items

    return items.filter(item => {
      const matches = item.name.toLowerCase().includes(query.toLowerCase())
      if (item.type === 'directory' && item.children) {
        const childMatches = filterFiles(item.children, query)
        if (childMatches.length > 0) {
          return true
        }
      }
      return matches
    }).map(item => {
      if (item.type === 'directory' && item.children) {
        return {
          ...item,
          children: filterFiles(item.children, query),
        }
      }
      return item
    })
  }

  const renderFileTree = (items: FileItem[], depth = 0) => {
    const filtered = filterFiles(items, searchQuery)

    return filtered.map(item => (
      <div key={item.path}>
        <div
          className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-bg-elevated transition-colors ${
            selectedFile === item.path ? 'bg-bg-elevated border-l-2 border-primary-600' : ''
          }`}
          style={{ paddingLeft: `${depth * 16 + 12}px` }}
          onClick={() => handleFileClick(item.path, item.type)}
        >
          {item.type === 'directory' ? (
            <Folder className="w-4 h-4 text-accent-amber flex-shrink-0" />
          ) : (
            <File className="w-4 h-4 text-primary-600 flex-shrink-0" />
          )}
          <span className="text-sm text-text-secondary flex-1 truncate">{item.name}</span>
          {item.type === 'file' && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleDownload(item.path)
              }}
              className="opacity-0 hover:opacity-100 group-hover:opacity-100 p-1 hover:bg-bg-app rounded"
            >
              <Download className="w-3 h-3 text-text-tertiary" />
            </button>
          )}
        </div>
        {item.type === 'directory' && expandedDirs.has(item.path) && item.children && (
          <div>
            {renderFileTree(item.children, depth + 1)}
          </div>
        )}
      </div>
    ))
  }

  return (
    <div className="w-[280px] border-r border-border-subtle bg-bg-surface flex flex-col">
      <div className="p-3 border-b border-border-subtle">
        <div className="relative mb-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
          <input
            type="text"
            placeholder="Search files..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-bg-elevated border border-border-subtle rounded-lg text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-primary-600"
          />
        </div>
        <div className="flex gap-2">
          <label className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-primary-600 hover:bg-primary-700 rounded-lg text-sm text-white cursor-pointer transition-colors">
            <Upload className="w-4 h-4" />
            Upload
            <input type="file" className="hidden" onChange={handleUpload} />
          </label>
          <button
            onClick={loadFiles}
            className="px-3 py-2 bg-bg-elevated hover:bg-border-subtle rounded-lg transition-colors"
          >
            <RefreshCw className={`w-4 h-4 text-text-secondary ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <RefreshCw className="w-6 h-6 text-text-tertiary animate-spin" />
          </div>
        ) : files.length === 0 ? (
          <div className="p-6 text-center">
            <File className="w-12 h-12 text-text-tertiary mx-auto mb-2" />
            <p className="text-sm text-text-tertiary">No files yet</p>
            <p className="text-xs text-text-tertiary mt-1">Upload files or ask the AI to create them</p>
          </div>
        ) : (
          <div className="py-2">
            {renderFileTree(files)}
          </div>
        )}
      </div>
    </div>
  )
}
