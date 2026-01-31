# Test Infrastructure

**Unit-first testing architecture** with mocked dependencies to prevent process exhaustion.

## Overview

Tests are organized using Vitest across both packages:
- **constellation-typescript**: Client library unit tests + minimal integration tests
- **agentbe-server**: Server unit tests

**Philosophy**: Test logic, not I/O. Mock everything except a tiny smoke test suite.

---

## Test Structure

### constellation-typescript/tests/

```
tests/
├── unit/                                    # Unit tests (mocked I/O)
│   ├── helpers/
│   │   └── mockFactories.ts                # Reusable mock utilities
│   ├── backends/
│   │   ├── LocalFilesystemBackend.test.ts  # Mock child_process, fs
│   │   ├── RemoteFilesystemBackend.test.ts # Mock ssh2
│   │   ├── MemoryBackend.test.ts           # Pure logic (no mocks needed)
│   │   ├── ScopedFilesystemBackend.test.ts # Mock parent backend
│   │   └── ScopedMemoryBackend.test.ts     # Mock parent backend
│   ├── pooling/
│   │   └── BackendPoolManager.test.ts      # Mock backend instances
│   └── security/
│       ├── safety.test.ts                  # Pure logic (no mocks needed)
│       └── pathValidator.test.ts           # Pure logic (no mocks needed)
├── integration/                             # Integration tests (real I/O)
│   └── smoke.test.ts                       # ~10 tests to verify real I/O works
└── tests-integration-archive/               # Archived old tests (not run)
```

### agentbe-server/tests/

```
tests/
├── unit/
│   └── mcp/
│       ├── LocalFilesystemMCPServer.test.ts # Mock backend
│       └── MemoryMCPServer.test.ts          # Mock backend
└── tests-integration-archive/                # Archived old tests (not run)
```

---

## Running Tests

### Unit Tests (Default - Fast, Safe)

```bash
# From repository root
pnpm test              # Run all unit tests (parallel, mocked)
pnpm test:unit         # Explicit unit test run

# From package directory
cd constellation-typescript
npm test               # Watch mode (development)
npm run test:unit      # Run once

cd agentbe-server
npm test               # Watch mode
npm run test:unit      # Run once
```

**Characteristics:**
- ✅ No process spawning (all I/O is mocked)
- ✅ Fast (seconds for entire suite)
- ✅ Platform-independent
- ✅ Can run hundreds in parallel
- ✅ No EAGAIN errors

### Integration Tests (Slow, Real I/O)

```bash
# From repository root
pnpm test:integration  # Run minimal smoke tests

# From constellation-typescript
npm run test:integration
```

**Characteristics:**
- ⚠️ Spawns real processes
- ⚠️ Writes real files
- ⚠️ Slow (~1 minute)
- ⚠️ Runs sequentially (maxWorkers: 1, fileParallelism: false)
- ⚠️ Only ~10 tests total

### All Tests

```bash
pnpm test:all   # Run unit + integration
```

---

## Unit Test Strategy

### What We Mock

**All I/O operations:**
- `child_process.spawn` - Command execution
- `fs/promises` - File system operations
- `ssh2.Client` - SSH connections
- Backend instances - For pool manager and scoped backend tests

### Mock Factories

Located in `tests/unit/helpers/mockFactories.ts`:

```typescript
import { createMockSpawn, createMockFileBackend, createMockSSH2Client } from '../helpers/mockFactories.js'
import * as child_process from 'child_process'

vi.mock('child_process')

// Mock command execution
const mockSpawn = createMockSpawn({ stdout: 'output', exitCode: 0 })
vi.mocked(child_process.spawn).mockReturnValue(mockSpawn)

await backend.exec('command')

expect(child_process.spawn).toHaveBeenCalledWith(...)
```

### What We Test

**Logic, validation, and transformations:**
- ✅ Path validation (rejects `/etc/passwd`, `../../etc`, `~/file`)
- ✅ Command safety (blocks dangerous commands BEFORE spawning)
- ✅ Correct spawn arguments construction
- ✅ Error handling
- ✅ Path translation (scoped backends)
- ✅ Configuration validation
- ✅ Pool management logic

**What we DON'T test:**
- ✗ Whether spawn actually works (that's Node.js's job)
- ✗ Whether files actually get written (that's fs's job)
- ✗ Whether SSH actually connects (that's ssh2's job)

---

## Example Unit Tests

### LocalFilesystemBackend

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LocalFilesystemBackend } from '../../../src/backends/LocalFilesystemBackend.js'
import { createMockSpawn } from '../helpers/mockFactories.js'
import * as child_process from 'child_process'
import * as fs from 'fs/promises'

vi.mock('child_process')
vi.mock('fs/promises')

describe('LocalFilesystemBackend (Unit)', () => {
  let backend: LocalFilesystemBackend

  beforeEach(() => {
    vi.clearAllMocks()
    backend = new LocalFilesystemBackend({
      rootDir: '/test/workspace',
      isolation: 'software',
      preventDangerous: true
    })
  })

  it('should reject absolute paths BEFORE calling fs', async () => {
    await expect(backend.read('/etc/passwd'))
      .rejects.toThrow('Absolute paths not allowed')

    // Critical: verify fs was NEVER called
    expect(fs.readFile).not.toHaveBeenCalled()
  })

  it('should block dangerous commands BEFORE spawning', async () => {
    await expect(backend.exec('rm -rf /'))
      .rejects.toThrow('Dangerous operation')

    // Critical: verify spawn was NEVER called
    expect(child_process.spawn).not.toHaveBeenCalled()
  })

  it('should call spawn with correct arguments', async () => {
    const mockSpawn = createMockSpawn({ stdout: 'output', exitCode: 0 })
    vi.mocked(child_process.spawn).mockReturnValue(mockSpawn)

    await backend.exec('echo hello')

    expect(child_process.spawn).toHaveBeenCalledWith(
      expect.stringMatching(/bash|sh/),
      ['-c', 'echo hello'],
      expect.objectContaining({
        cwd: '/test/workspace',
        stdio: ['pipe', 'pipe', 'pipe']
      })
    )
  })
})
```

### Security Tests (Pure Logic - No Mocks!)

```typescript
import { describe, it, expect } from 'vitest'
import { isDangerous, validatePath } from '../../../src/...'

describe('Command Safety (Unit)', () => {
  it('should detect dangerous commands', () => {
    expect(isDangerous('rm -rf /')).toBe(true)
    expect(isDangerous('sudo apt-get install')).toBe(true)
    expect(isDangerous(':(){ :|:& };:')).toBe(true)
  })

  it('should allow safe commands', () => {
    expect(isDangerous('ls -la')).toBe(false)
    expect(isDangerous('echo hello')).toBe(false)
  })
})

describe('Path Validation (Unit)', () => {
  it('should reject absolute paths', () => {
    expect(() => validatePath('/etc/passwd')).toThrow()
    expect(() => validatePath('../../../etc')).toThrow()
  })

  it('should allow safe relative paths', () => {
    expect(() => validatePath('file.txt')).not.toThrow()
    expect(() => validatePath('subdir/file.txt')).not.toThrow()
  })
})
```

---

## Integration Tests (Minimal)

**Only test that real I/O actually works end-to-end.**

```typescript
describe('Smoke Tests', () => {
  it('should actually write and read a file', async () => {
    const backend = new LocalFilesystemBackend({
      rootDir: getTempDir(),
      isolation: 'software'
    })

    await backend.write('test.txt', 'hello')
    const content = await backend.read('test.txt')

    expect(content).toBe('hello')

    await backend.destroy()
  })

  // ~9 more minimal tests
})
```

---

## Configuration

### vitest.config.ts (Unit Tests)

```typescript
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    exclude: ['**/tests-integration-archive/**'],
    // No special limits - mocked tests are fast and safe
    testTimeout: 10000
  }
})
```

### vitest.integration.config.ts (Integration Tests)

```typescript
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    // Critical: Prevent process exhaustion
    maxWorkers: 1,           // One worker only
    fileParallelism: false,  // Run files sequentially
    maxConcurrency: 1,       // One test at a time
    testTimeout: 60000       // Longer timeout for real I/O
  }
})
```

---

## Why This Architecture?

### Before (Integration Tests Disguised as Unit Tests)

| Metric | Old Architecture |
|--------|-----------------|
| Test count | 228 tests |
| Process spawns | 500-800 processes |
| Run time | Minutes |
| Failures | EAGAIN errors, system meltdown |
| Platform | macOS/Linux-specific |
| Parallelism | Limited (EAGAIN risk) |

### After (True Unit Tests)

| Metric | New Architecture |
|--------|-----------------|
| Unit tests | 500+ tests |
| Integration tests | ~10 tests |
| Process spawns | **0 (unit), ~10 (integration)** |
| Run time | **Seconds (unit), ~1 min (integration)** |
| Failures | None |
| Platform | **All platforms** |
| Parallelism | **Unlimited (unit)** |

---

## Test Coverage Goals

- **Unit Tests**: >90% code coverage
- **Integration Tests**: Cover critical paths only
- **Security Tests**: All attack vectors
- **Total**: ~500+ tests

---

## CI/CD Integration

```yaml
# .github/workflows/test.yml
jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: pnpm/action-setup@v2
      - run: pnpm install
      - run: pnpm test:unit       # Fast, parallel

  integration-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: pnpm/action-setup@v2
      - run: pnpm install
      - run: pnpm test:integration # Slow, sequential
```

---

## Key Principles

1. **Mock everything except a tiny smoke test suite**
2. **Test logic, not I/O**
3. **Never spawn processes in unit tests**
4. **Integration tests should be <10 total**
5. **Keep unit tests fast (<10ms each)**
6. **Security tests are pure logic (no mocks needed)**

---

## Debugging Tests

### Run with verbose output

```bash
npm test -- --reporter=verbose
```

### Run specific test

```bash
npm test -- tests/unit/backends/LocalFilesystemBackend.test.ts
```

### Debug in VS Code

Add to `.vscode/launch.json`:

```json
{
  "type": "node",
  "request": "launch",
  "name": "Debug Unit Tests",
  "runtimeExecutable": "npm",
  "runtimeArgs": ["test", "--", "--run"],
  "console": "integratedTerminal"
}
```

---

## Migration Notes

**Old integration tests archived** in `tests-integration-archive/`:
- These tests spawned real processes
- They're preserved for reference
- They are NOT run by default

**To run archived tests** (not recommended):
```bash
# They will likely cause EAGAIN errors!
vitest run tests-integration-archive/**/*.test.ts
```

---

## Resources

- [Vitest Documentation](https://vitest.dev)
- [Vitest Mocking Guide](https://vitest.dev/guide/mocking.html)
- [Mock Factories](./constellation-typescript/tests/unit/helpers/mockFactories.ts)
- [TESTING-PLAN.md](./TESTING-PLAN.md) - Original test specification
