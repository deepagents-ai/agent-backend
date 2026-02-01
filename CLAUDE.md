# Agent Backend - Claude Development Guide

Secure, isolated backend for AI agents supporting code execution, file operations, and persistent storage. **Formerly AgentBackend.**

## Project Structure

```
agentbe-typescript/src/
├── backends/                   # Backend implementations
│   ├── LocalFilesystemBackend.ts    # Local file + exec operations
│   ├── RemoteFilesystemBackend.ts   # Remote via SSH
│   ├── MemoryBackend.ts             # In-memory key/value
│   ├── ScopedFilesystemBackend.ts   # Scoped filesystem wrapper
│   ├── ScopedMemoryBackend.ts       # Scoped memory wrapper
│   └── pathValidation.ts            # Path security utilities
├── mcp/                        # Model Context Protocol integration
├── logging/                    # Operations logging
├── utils/                      # Shared utilities
├── BackendPoolManager.ts       # Connection pooling
├── safety.ts                   # Command safety validation
├── types.ts                    # Type definitions & errors
└── index.ts                    # Public exports

remote/
├── src/mcp/servers/           # MCP server implementations
│   ├── LocalFilesystemMCPServer.ts
│   ├── MemoryMCPServer.ts
│   └── RemoteFilesystemMCPServer.ts
└── tests/unit/                # Unit tests
```

## Architecture

### Backend Types
- **LocalFilesystemBackend** - File operations + command execution on local machine
- **RemoteFilesystemBackend** - Same API via SSH to remote server
- **MemoryBackend** - In-memory key/value storage (no exec)
- **Scoped Backends** - Wrap any backend to restrict operations to a subdirectory

### Key Patterns
1. **Scoping** - `.scope(path)` creates isolated sub-environments for multi-tenancy
2. **Pooling** - `BackendPoolManager` reuses connections for stateless servers
3. **MCP Integration** - `.getMCPClient()` exposes tools via Model Context Protocol
4. **Security Layers** - Command validation, path escape prevention, isolation modes

### Isolation Modes
- `'auto'` - Detects best available (bubblewrap → software)
- `'bwrap'` - Linux namespace isolation via bubblewrap
- `'software'` - Heuristics-based path/command validation
- `'none'` - No isolation (trust mode)

## Code Style

**TypeScript Standards:**
- No semicolons, single quotes (ESLint enforced)
- Explicit types, avoid `any`
- Zod schemas for config validation
- Custom error classes (`BackendError`, `DangerousOperationError`, `PathEscapeError`)

**Import Patterns:**
```typescript
import type { Backend, FileBasedBackend } from './types.js'
import { LocalFilesystemBackend } from './backends/LocalFilesystemBackend.js'
```

## Testing

### Unit Tests (Vitest)
```bash
pnpm test --run              # Run all tests
pnpm test -t "pattern"       # Run matching tests
```

**Test Structure:**
- `agentbe-typescript/tests/unit/` - Unit tests with mocked I/O
- `remote/tests/unit/` - MCP server tests
- Global setup in `tests/unit/setup.ts` mocks child_process and fs/promises

**Mock Pattern:**
```typescript
import { vi } from 'vitest'
import { createMockSpawn } from './helpers/mockFactories.js'

vi.mocked(child_process.spawn).mockReturnValue(
  createMockSpawn({ stdout: 'output', exitCode: 0 })
)
```

**IMPORTANT:** Unit tests use global mocks to prevent real I/O. If you see "UNIT TEST VIOLATION" errors, you forgot to mock the operation.

## Security

### Command Safety (safety.ts)
```typescript
isDangerous(command)          // Returns true for dangerous commands
isCommandSafe(command)        // Returns { safe, reason }
```

**Dangerous patterns blocked:**
- Destructive: `rm -rf /`, `dd if=/dev/zero`
- Privilege escalation: `sudo`, `su`
- Remote execution: `curl ... | sh`, `eval`
- Shell injection: `;`, `&&`, `||`, backticks, `$()`
- Network tampering: `iptables`, `ifconfig`

### Path Validation
- Absolute paths treated as relative to scope
- `..` traversal blocked if escapes scope
- Workspace boundaries enforced at multiple layers

## Common Commands

```bash
# Development
pnpm install                 # Install dependencies
pnpm run build              # Build packages
pnpm run typecheck          # Verify types
pnpm test --run             # Run all tests

# Monorepo structure
pnpm -r <command>           # Run in all packages
```

## Development Notes

- **Monorepo**: Uses pnpm workspaces (`agentbe-typescript`, `remote`)
- **Package Name**: Published as `agent-backend` (formerly `agent-backend`)
- **Breaking Change**: v0.6.0 renamed from AgentBackend → AgentBackend
- **MCP Servers**: Wrap backends with tool tracking for MCP compatibility
- **Connection Status**: Scoped backends read `connected` from parent dynamically
- **Config Overrides**: BackendPoolManager supports per-request config merging

## Key Files to Understand

1. **backends/LocalFilesystemBackend.ts** - Core implementation, ~500 LOC
2. **backends/ScopedFilesystemBackend.ts** - Scoping logic, path translation
3. **BackendPoolManager.ts** - Connection pooling for stateless servers
4. **safety.ts** - Command safety validation patterns
5. **mcp/servers/*.ts** - MCP server wrappers with tool tracking

## Error Handling

```typescript
try {
  await backend.exec(command)
} catch (error) {
  if (error instanceof DangerousOperationError) {
    console.log('Blocked dangerous command:', error.command)
  } else if (error instanceof PathEscapeError) {
    console.log('Path escapes scope:', error.path)
  } else if (error instanceof BackendError) {
    console.log('Backend error:', error.message, error.code)
  }
}
```

## Contributing

- Use Conventional Commits (`feat:`, `fix:`, `docs:`, etc.)
- Add tests for new features (unit tests required)
- Update JSDoc for public APIs
- Run `pnpm test --run` before committing
