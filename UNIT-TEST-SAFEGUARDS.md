# Unit Test Safeguards

**Deterministic prevention of subprocess spawning in unit tests.**

## Problem

Backend constructors call I/O operations:
- `LocalFilesystemBackend` → `execSync()`, `mkdir()`
- `RemoteFilesystemBackend` → Creates SSH client
- These run BEFORE `beforeEach` mocks in individual tests

## Solution: Multi-Layer Safeguards

### Layer 1: Global Setup File

**File**: `tests/unit/setup.ts`

Runs **before all tests** and mocks I/O globally:

```typescript
// Global mocks that throw descriptive errors if unmocked I/O is attempted
vi.mock('child_process', () => ({
  spawn: vi.fn(() => { throw new Error('❌ Unmocked spawn!') }),
  execSync: vi.fn(() => { throw new Error('❌ Unmocked execSync!') }),
  // ... etc
}))

vi.mock('fs/promises', () => ({
  mkdir: vi.fn(() => { throw new Error('❌ Unmocked mkdir!') }),
  readFile: vi.fn(() => { throw new Error('❌ Unmocked readFile!') }),
  // ... etc
}))

vi.mock('ssh2', () => ({
  Client: vi.fn(() => { throw new Error('❌ Unmocked SSH Client!') })
}))
```

**Benefits:**
- ✅ Catches unmocked I/O immediately with clear error messages
- ✅ Prevents accidental process spawning
- ✅ Global coverage (no test can bypass this)

### Layer 2: Explicit Config in Tests

**All backend constructors use explicit config** to avoid I/O:

```typescript
beforeEach(() => {
  // Mock mkdir for constructor
  vi.mocked(fs.mkdir).mockResolvedValue(undefined)

  backend = new LocalFilesystemBackend({
    rootDir: '/test/workspace',
    shell: 'bash',        // Explicit (not 'auto') → avoids execSync
    isolation: 'software' // Explicit (not 'auto') → avoids execSync
    // validateUtils: false (default) → avoids execSync
  })
})
```

### Layer 3: Test-Level Mocks

**Individual tests mock specific operations:**

```typescript
it('should call spawn with correct args', async () => {
  const mockSpawn = createMockSpawn({ stdout: 'output', exitCode: 0 })
  vi.mocked(child_process.spawn).mockReturnValue(mockSpawn as any)

  await backend.exec('command')

  expect(child_process.spawn).toHaveBeenCalledWith(...)
})
```

---

## How It Works

### Timeline

```
1. Vitest starts
2. ✅ tests/unit/setup.ts runs → Global mocks installed
3. ✅ Test file loads → Global mocks already in place
4. ✅ beforeEach runs → Specific mocks configured
5. ✅ Constructor runs → Uses mocked mkdir (doesn't actually create dir)
6. ✅ Test executes → Uses mocked spawn (doesn't actually spawn process)
```

### What Happens if Unmocked I/O is Attempted

```typescript
// If any code tries to spawn without mocking:
child_process.spawn('command', [])

// Throws immediately:
// ❌ UNIT TEST VIOLATION: Unmocked spawn call detected!
// This means a unit test is trying to spawn a real process.
// Fix: Ensure vi.mocked(child_process.spawn).mockReturnValue(...) is called BEFORE the code executes.
```

---

## Verification Checklist

### Before Running Tests

**1. Check global setup is loaded:**
```bash
grep "setupFiles" constellation-typescript/vitest.config.ts
# Should output: setupFiles: ['./tests/unit/setup.ts']
```

**2. Verify mocks are in place:**
```bash
cat constellation-typescript/tests/unit/setup.ts | grep "vi.mock"
# Should show mocks for: child_process, fs/promises, ssh2
```

**3. Check test configurations:**
```bash
# All LocalFilesystemBackend constructors should have:
grep -A 5 "new LocalFilesystemBackend" constellation-typescript/tests/unit/backends/LocalFilesystemBackend.test.ts | grep "shell:"
# Should output: shell: 'bash' (explicit, not 'auto')
```

### When Running Tests

**1. Start with safeguard verification:**
```bash
cd constellation-typescript

# This should output the safeguard message:
npm test -- tests/unit/security/safety.test.ts --run 2>&1 | grep "safeguards"
# Expected: "✅ Unit test safeguards enabled"
```

**2. Run one test file:**
```bash
npm test -- tests/unit/backends/LocalFilesystemBackend.test.ts --run
```

**If it fails with "Unmocked X call detected":**
- ✅ **Good!** Safeguards are working
- ❌ **Action needed:** Fix the test to mock that operation

**If it passes:**
- ✅ Tests are properly mocked
- ✅ No processes spawned

**3. Monitor system (optional):**
```bash
# Terminal 1: Watch process count
watch -n 0.5 'ps aux | wc -l'

# Terminal 2: Run tests
npm run test:unit

# Process count should NOT increase during unit tests
```

---

## Common Issues & Fixes

### Issue: "Unmocked execSync call detected"

**Cause:** Backend constructor called with `shell: 'auto'` or `isolation: 'auto'`

**Fix:**
```typescript
// Before (triggers execSync):
new LocalFilesystemBackend({
  rootDir: '/test',
  shell: 'auto' // ❌ Triggers detectShell() → execSync
})

// After (uses mock):
new LocalFilesystemBackend({
  rootDir: '/test',
  shell: 'bash' // ✅ No detection needed
})
```

### Issue: "Unmocked mkdir call detected"

**Cause:** Constructor's `ensureRootDir()` wasn't mocked

**Fix:**
```typescript
beforeEach(() => {
  // Add this BEFORE constructing backend:
  vi.mocked(fs.mkdir).mockResolvedValue(undefined)

  backend = new LocalFilesystemBackend({ ... })
})
```

### Issue: "Unmocked SSH Client instantiation"

**Cause:** RemoteFilesystemBackend created without mocking SSH2

**Fix:**
```typescript
import { Client } from 'ssh2'

beforeEach(() => {
  // Mock SSH2 Client
  const mockClient = createMockSSH2Client()
  vi.mocked(Client).mockImplementation(() => mockClient as any)

  backend = new RemoteFilesystemBackend({ ... })
})
```

---

## Files Changed

### New Files
- ✅ `constellation-typescript/tests/unit/setup.ts` - Global safeguards

### Modified Files
- ✅ `constellation-typescript/vitest.config.ts` - Added setupFiles
- ✅ `constellation-typescript/tests/unit/backends/LocalFilesystemBackend.test.ts` - Explicit config
- ✅ All test files - Use explicit shell/isolation config

---

## Testing the Safeguards

**Test that safeguards work:**

```typescript
// Create a test that SHOULD fail:
it('should catch unmocked spawn', async () => {
  // Don't mock spawn
  const backend = new LocalFilesystemBackend({
    rootDir: '/test',
    shell: 'bash',
    isolation: 'software'
  })

  // This should throw "Unmocked spawn call detected"
  await backend.exec('echo test')
})
```

**Expected result:** Test fails with clear error about unmocked spawn ✅

---

## Summary

**Three layers of protection:**
1. **Global setup** - Prevents any unmocked I/O
2. **Explicit config** - Avoids triggering I/O in constructors
3. **Test-level mocks** - Specific mocks for each operation

**Result:**
- 🚫 **0 processes spawned** during unit tests
- ✅ **Clear errors** if unmocked I/O attempted
- ✅ **Fast, safe tests** that can run in parallel

**To verify everything is safe:**
```bash
# Watch process count while running tests
watch -n 0.5 'ps aux | wc -l' &

# Run all unit tests
npm run test:unit

# Process count should remain stable (no +500 processes!)
```
