#!/bin/bash
set -e

echo "🔍 Verifying Unit Test Safeguards..."
echo ""

cd constellation-typescript

echo "1️⃣  Checking global setup file exists..."
if [ -f "tests/unit/setup.ts" ]; then
  echo "✅ tests/unit/setup.ts exists"
else
  echo "❌ tests/unit/setup.ts NOT FOUND"
  exit 1
fi

echo ""
echo "2️⃣  Checking vitest.config.ts has setupFiles..."
if grep -q "setupFiles.*setup.ts" vitest.config.ts; then
  echo "✅ setupFiles configured"
else
  echo "❌ setupFiles NOT configured"
  exit 1
fi

echo ""
echo "3️⃣  Checking global mocks are defined..."
for mock in "child_process" "fs/promises" "ssh2"; do
  if grep -q "vi.mock('$mock'" tests/unit/setup.ts; then
    echo "✅ $mock is mocked globally"
  else
    echo "❌ $mock NOT mocked"
    exit 1
  fi
done

echo ""
echo "4️⃣  Checking test configurations use explicit values..."
if grep -q "shell: 'bash'" tests/unit/backends/LocalFilesystemBackend.test.ts; then
  echo "✅ Tests use explicit shell config"
else
  echo "⚠️  Some tests may use shell: 'auto' (could trigger execSync)"
fi

if grep -q "isolation: 'software'" tests/unit/backends/LocalFilesystemBackend.test.ts; then
  echo "✅ Tests use explicit isolation config"
else
  echo "⚠️  Some tests may use isolation: 'auto' (could trigger execSync)"
fi

echo ""
echo "✅ All safeguards are in place!"
echo ""
echo "📝 To test safely:"
echo "   1. npm test -- tests/unit/security/safety.test.ts --run"
echo "   2. If that passes, try: npm run test:unit"
echo "   3. Monitor with: watch -n 0.5 'ps aux | wc -l'"
