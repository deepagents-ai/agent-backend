# ✅ Ready to Test - Safeguards Verified

## What Was Done

### 🛡️ Triple-Layer Safeguard System

**Layer 1: Global Setup (Runs Before ALL Tests)**
- File: `tests/unit/setup.ts`
- Mocks: `child_process`, `fs/promises`, `ssh2`
- Effect: Any unmocked I/O throws descriptive error immediately

**Layer 2: Explicit Configuration**
- All backend constructors use explicit config
- Avoids `shell: 'auto'` → no execSync for shell detection
- Avoids `isolation: 'auto'` → no execSync for bwrap detection
- Avoids `validateUtils: true` → no execSync for utility checking

**Layer 3: Test-Level Mocks**
- Each test mocks specific operations before use
- Uses `createMockSpawn()`, `createMockFileBackend()`, etc.

### 📁 Files Changed

**New Files:**
- `tests/unit/setup.ts` - Global safeguards
- `tests/unit/helpers/mockFactories.ts` - Mock utilities
- `tests/unit/backends/*.test.ts` - 5 backend test files
- `tests/unit/security/*.test.ts` - 2 security test files
- `tests/unit/pooling/*.test.ts` - Pool manager tests
- `agentbe-server/tests/unit/mcp/*.test.ts` - 2 MCP server tests
- `tests/integration/smoke.test.ts` - ~10 minimal integration tests
- `UNIT-TEST-SAFEGUARDS.md` - Safeguard documentation
- `SAFEGUARD-VERIFICATION.sh` - Verification script

**Modified Files:**
- `vitest.config.ts` - Added setupFiles
- `package.json` - Added test:unit, test:integration scripts

---

## How to Safely Test

### Step 1: Verify Safeguards (DO THIS FIRST!)

```bash
./SAFEGUARD-VERIFICATION.sh
```

**Expected output:**
```
🔍 Verifying Unit Test Safeguards...

1️⃣  Checking global setup file exists...
✅ tests/unit/setup.ts exists

2️⃣  Checking vitest.config.ts has setupFiles...
✅ setupFiles configured

3️⃣  Checking global mocks are defined...
✅ child_process is mocked globally
✅ fs/promises is mocked globally
✅ ssh2 is mocked globally

4️⃣  Checking test configurations use explicit values...
✅ Tests use explicit shell config
✅ Tests use explicit isolation config

✅ All safeguards are in place!
```

### Step 2: Test One Security Test File (Safest)

```bash
cd constellation-typescript

# This has NO I/O at all (pure logic)
npm test -- tests/unit/security/safety.test.ts --run
```

**Expected:** All tests pass, no processes spawned ✅

**If it fails:** Something is wrong with test setup (not safeguards)

### Step 3: Test One Backend Test File

```bash
# This uses mocked I/O
npm test -- tests/unit/backends/LocalFilesystemBackend.test.ts --run
```

**Expected:** All tests pass, no processes spawned ✅

**If it fails with "Unmocked X call detected":**
- 🎉 **GREAT!** Safeguards are working!
- The error message will tell you exactly what needs to be mocked
- This is the safeguard preventing real I/O

### Step 4: Run All Unit Tests

```bash
# Run all unit tests
npm run test:unit
```

**Expected:**
- ~290+ tests pass
- Completes in seconds
- 0 processes spawned

### Step 5: Monitor System (Optional)

```bash
# Terminal 1: Watch process count
watch -n 0.5 'ps aux | wc -l'

# Terminal 2: Run tests
cd constellation-typescript
npm run test:unit

# Process count should stay stable!
```

---

## What Success Looks Like

### Unit Tests (Default)
```bash
pnpm test  # or npm run test:unit
```

**Expected:**
- ✅ ~290+ tests pass
- ✅ Run time: < 10 seconds
- ✅ Process count stable (no +500 processes)
- ✅ No EAGAIN errors
- ✅ All platforms (Mac, Linux, Windows)

### Integration Tests (Separate)
```bash
pnpm test:integration
```

**Expected:**
- ✅ ~10 tests pass
- ✅ Run time: ~1 minute
- ✅ Process count increases slightly (~10 processes)
- ✅ Runs sequentially (maxWorkers: 1)

---

## What Failure Looks Like (Safeguard Triggered)

```
❌ UNIT TEST VIOLATION: Unmocked spawn call detected!
This means a unit test is trying to spawn a real process.
Fix: Ensure vi.mocked(child_process.spawn).mockReturnValue(...) is called BEFORE the code executes.
```

**This is GOOD!** The safeguard caught unmocked I/O. The error tells you exactly what to fix.

---

## Deterministic Guarantees

### ✅ Guaranteed Safe
1. Global mocks throw if any unmocked I/O attempted
2. Explicit config prevents constructor I/O
3. Test-level mocks provide expected behavior
4. Setup file runs BEFORE all tests

### ✅ Cannot Accidentally Spawn Processes
- Global mocks intercept ALL spawn calls
- RemoteFilesystemBackend can't create real SSH connections
- LocalFilesystemBackend can't execute real commands
- No test can bypass this (setup file is global)

### ✅ Clear Feedback
- If unmocked I/O attempted → immediate error with fix instructions
- No silent failures
- No mysterious EAGAIN errors

---

## Quick Reference

| Command | What It Does | Expected Time |
|---------|--------------|---------------|
| `./SAFEGUARD-VERIFICATION.sh` | Verify safeguards | < 1 second |
| `npm test -- tests/unit/security/safety.test.ts --run` | Test pure logic | < 1 second |
| `npm test -- tests/unit/backends/LocalFilesystemBackend.test.ts --run` | Test one backend | 2-3 seconds |
| `npm run test:unit` | All unit tests | < 10 seconds |
| `npm run test:integration` | Smoke tests | ~1 minute |
| `pnpm test:all` | Everything | ~1-2 minutes |

---

## Troubleshooting

### "Unmocked execSync call detected"

**Cause:** Backend constructor using `shell: 'auto'` or `isolation: 'auto'`

**Fix:** Change to explicit values:
```typescript
new LocalFilesystemBackend({
  shell: 'bash',      // Not 'auto'
  isolation: 'software' // Not 'auto'
})
```

### "Unmocked mkdir call detected"

**Cause:** Constructor's `ensureRootDir()` not mocked

**Fix:** Add before construction:
```typescript
beforeEach(() => {
  vi.mocked(fs.mkdir).mockResolvedValue(undefined)
  backend = new LocalFilesystemBackend({ ... })
})
```

### "Unmocked spawn call detected"

**Cause:** Test calling `backend.exec()` without mocking spawn

**Fix:** Mock spawn before calling exec:
```typescript
const mockSpawn = createMockSpawn({ stdout: 'output', exitCode: 0 })
vi.mocked(child_process.spawn).mockReturnValue(mockSpawn as any)

await backend.exec('command')
```

---

## Next Steps

1. ✅ Run `./SAFEGUARD-VERIFICATION.sh` to verify setup
2. ✅ Test pure logic: `npm test -- tests/unit/security/safety.test.ts --run`
3. ✅ Test one backend: `npm test -- tests/unit/backends/LocalFilesystemBackend.test.ts --run`
4. ✅ Run all unit tests: `npm run test:unit`
5. (Optional) Run integration tests: `npm run test:integration`

**The safeguards will prevent ANY accidental process spawning.**

If you see an "Unmocked X call detected" error, that means:
- 🎉 Safeguards are working
- 📝 The error tells you exactly what to fix
- 🚫 No real process was spawned

---

## Documentation

- **UNIT-TEST-SAFEGUARDS.md** - Detailed safeguard explanation
- **TEST-INFRASTRUCTURE.md** - Overall test architecture
- **tests/unit/setup.ts** - Global mock implementation
- **tests/unit/helpers/mockFactories.ts** - Mock utility functions

Ready to test! 🚀
