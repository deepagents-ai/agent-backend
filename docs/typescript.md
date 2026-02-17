# TypeScript Development

TypeScript-specific development guide for the `agent-backend` package.

## Package Info

| Field       | Value                          |
|-------------|--------------------------------|
| Package     | `agent-backend`                |
| Registry    | npm                            |
| Manager     | pnpm                           |
| Test runner | Vitest                         |
| Build       | Vite                           |
| Linter      | ESLint                         |
| Source       | `typescript/src/`              |
| Tests        | `typescript/tests/unit/`       |

## Commands

All commands can be run from the monorepo root via Make or from the `typescript/` directory via pnpm.

| Task        | Make (root)              | pnpm (`typescript/`)    |
|-------------|--------------------------|-------------------------|
| Build       | `make build-typescript`  | `pnpm run build`        |
| Test        | `make test-typescript`   | `pnpm test --run`       |
| Test (watch)| --                       | `pnpm test`             |
| Lint        | `make lint-typescript`   | `pnpm run lint`         |
| Lint (fix)  | `make lint-fix`          | `pnpm run lint:fix`     |
| Typecheck   | `make typecheck`         | `pnpm run typecheck`    |

## Code Style

- No semicolons
- Single quotes
- Explicit types -- avoid `any`
- `.js` extensions in all imports (e.g., `import { Foo } from './types.js'`)
- Zod schemas for config validation
- Custom error classes: `BackendError`, `DangerousOperationError`, `PathEscapeError`

ESLint enforces these rules. Run `make lint-fix` or `pnpm run lint:fix` to auto-fix.

## Testing

### Unit Tests

Tests live in `typescript/tests/unit/` and use Vitest with global mocks.

The global setup file (`tests/unit/setup.ts`) mocks `child_process` and `fs/promises` to prevent real I/O during tests. If a test calls a real I/O function without mocking it first, it throws a **"UNIT TEST VIOLATION"** error. This is intentional -- always mock before calling code under test.

**Mock pattern:**

```typescript
import { vi } from 'vitest'
import { createMockSpawn } from './helpers/mockFactories.js'

beforeEach(() => {
  vi.mocked(child_process.spawn).mockReturnValue(
    createMockSpawn({ stdout: 'output', exitCode: 0 })
  )

  vi.mocked(fs.writeFile).mockResolvedValue(undefined)
})
```

Use the provided helper factories (`createMockSpawn`, `createMockFileBackend`) rather than building mocks from scratch.

### Running Tests

```bash
pnpm test --run              # All tests, single run
pnpm test -t "safety"        # Filter by pattern
pnpm test --coverage         # With coverage report
```

## Key Files

| File | Purpose |
|------|---------|
| `typescript/src/backends/LocalFilesystemBackend.ts` | Core backend implementation |
| `typescript/src/backends/ScopedFilesystemBackend.ts` | Scoping logic, path translation |
| `typescript/src/BackendPoolManager.ts` | Connection pooling for stateless servers |
| `typescript/src/safety.ts` | Command safety validation patterns |
| `typescript/src/server/AgentBackendMCPServer.ts` | Adaptive MCP server with duck typing |
| `typescript/bin/agent-backend.js` | CLI entry point for MCP servers |

## Error Handling

```typescript
try {
  await backend.exec(command)
} catch (error) {
  if (error instanceof DangerousOperationError) {
    // Command blocked by safety validation
  } else if (error instanceof PathEscapeError) {
    // Path attempted to escape scope
  } else if (error instanceof BackendError) {
    // General backend error (check error.code)
  }
}
```

## Gotchas

- Scoped backends read `connected` from the parent dynamically via a getter, not a copied property.
- `BackendPoolManager` supports per-request config overrides.
- `AgentBackendMCPServer` uses duck typing to detect exec capability -- it does not check backend type.
- A single adaptive server class replaces the old separate LocalFilesystem/Remote/Memory server classes.
- `destroy()` closes all tracked closeables (MCP clients, transports) before tearing down the backend.
- Scoped backends delegate `trackCloseable()` to their parent backend, so resources are closed when the parent is destroyed.

## Development Workflows

### Working on the TypeScript Package

```bash
make dev
```

This starts the mprocs TUI with TypeScript watch mode. Edit files under `typescript/src/` and watch the build output in the mprocs pane. The watcher rebuilds on every change.

### Working with the NextJS Example

```bash
NEXTJS=1 make dev
```

This adds the NextJS example app to the mprocs session alongside the daemon. The NextJS app picks up TypeScript changes on the next request.

Alternatively, use the dedicated target:

```bash
make nextjs
```

### Running the TSBasic Example

```bash
make tsbasic
```

Builds the TypeScript package, then runs the TSBasic CLI example.

## Docker

Build the `agentbe-daemon` Docker image:

```bash
make docker-build
```

The image is used by `make dev` to simulate a remote deployment. The Docker daemon exposes:

- Port 3001: MCP server
- Port 2222: SSH access

## Troubleshooting

### Port Conflicts

If ports 3000, 3001, or 2222 are in use:

```bash
lsof -ti:3001 | xargs kill -9    # MCP server
lsof -ti:3000 | xargs kill -9    # NextJS
```

### TypeScript Changes Not Appearing

1. Check the typescript-watch pane in mprocs for compilation errors.
2. Verify the build succeeded (no red output).
3. Restart the dependent process by selecting it in mprocs and pressing `r`.

### Remote Mode Issues

1. Verify the Docker image exists: `docker images | grep agentbe-daemon`
2. Check the container is running: `docker ps | grep agentbe-daemon`
3. Test the MCP endpoint: `curl http://localhost:3001/health`
4. View container logs: `docker logs agentbe-daemon`
