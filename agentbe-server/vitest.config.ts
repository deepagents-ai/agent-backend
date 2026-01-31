import { defineConfig } from 'vitest/config'
import path from 'path'

/**
 * Vitest configuration for agentbe-server UNIT TESTS
 *
 * Unit tests mock backend dependencies.
 * They test MCP server logic without spawning actual servers or backends.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: [
      'tests/unit/**/*.test.ts',
      'src/**/*.test.ts'
    ],
    exclude: [
      '**/node_modules/**',
      '**/tests-integration-archive/**'
    ],
    testTimeout: 10000, // Fast unit tests
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
})
