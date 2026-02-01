import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'
import path from 'path'

export default defineConfig({
  plugins: [
    dts({
      include: ['src/**/*'],
      exclude: [
        '**/*.test.ts',
        'tests/**/*',
        // TODO Phase 8: Exclude files with archived dependencies
        'src/mcp/server.ts',
        'src/mcp/local-client.ts'
      ]
    })
  ],
  build: {
    lib: {
      entry: {
        index: path.resolve(__dirname, 'src/index.ts'),
        'mcp/index': path.resolve(__dirname, 'src/mcp/index.ts'),
        // TODO Phase 8: mcp/server.ts will move to agentbe-server package
        // Temporarily excluded from build due to archived dependencies
        // 'mcp/server': path.resolve(__dirname, 'src/mcp/server.ts'),
      },
      formats: ['es', 'cjs']
    },
    sourcemap: true,
    rollupOptions: {
      external: [
        'fs', 'fs/promises', 'path', 'child_process', 'os', 'url', 'crypto',
        'ssh2', 'node-fuse-bindings', 'util', 'events',
        '@modelcontextprotocol/sdk/server/mcp.js',
        '@modelcontextprotocol/sdk/server/stdio.js',
        '@modelcontextprotocol/sdk/server/streamableHttp.js',
        '@modelcontextprotocol/sdk/client/index.js',
        '@modelcontextprotocol/sdk/client/stdio.js',
        '@modelcontextprotocol/sdk/client/streamableHttp.js',
        'express', 'zod', 'minimatch'
      ],
      output: {
        exports: 'auto',
        sourcemapExcludeSources: false
      }
    },
    target: 'node18',
    ssr: true
  },
  define: {
    global: 'globalThis'
  }
})