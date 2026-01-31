# MCP Testing Strategy

## Why There Are No Tests Here

The `getMCPClient()` method in the backend classes is a thin wrapper that:
1. Constructs command-line arguments based on backend configuration
2. Spawns the `agentbe-server` binary via `StdioClientTransport`
3. Returns an MCP client connected to this process

**Testing this method directly would be incorrect because:**
- ❌ It requires building and spawning the `agentbe-server` binary
- ❌ Creates circular dependency (constellation-typescript depending on agentbe-server for tests)
- ❌ Spawns processes for each test, contributing to EAGAIN errors
- ❌ Makes tests slow and brittle
- ❌ Violates unit testing principles (should not spawn external binaries)

## Where MCP Testing Happens

MCP functionality is properly tested in the **agentbe-server** package:

### `agentbe-server/tests/mcp-servers/`

Direct testing of MCP server classes without spawning binaries:

```typescript
// LocalFilesystemMCPServer.test.ts
const backend = new LocalFilesystemBackend({ rootDir: tempDir })
const server = new LocalFilesystemMCPServer(backend)

// Test tool registration
const tools = server.listTools()
expect(tools.map(t => t.name)).toContain('read_text_file')
expect(tools.map(t => t.name)).toContain('exec')

// Test tool execution
const result = await server.executeTool('write_file', {
  path: 'test.txt',
  content: 'Hello'
})
expect(result.success).toBe(true)
```

### Benefits of This Approach

✅ **No process spawning** - Direct class instantiation and method calls
✅ **Fast tests** - No process overhead
✅ **Proper separation** - Client library tests backend logic, server package tests MCP protocol
✅ **No circular dependencies** - Each package tests its own responsibilities
✅ **Better coverage** - Can test internal MCP server logic directly

## Testing Matrix

| Component | Test Location | Spawns Binary? |
|-----------|---------------|----------------|
| Backend operations (read, write, exec) | constellation-typescript/tests/backends/ | ❌ No |
| Backend pooling | constellation-typescript/tests/pooling/ | ❌ No |
| Security validation | constellation-typescript/tests/security/ | ❌ No |
| **MCP Server Classes** | agentbe-server/tests/mcp-servers/ | ❌ No |
| **MCP Tool Implementations** | agentbe-server/tests/mcp-servers/ | ❌ No |
| CLI Integration | agentbe-server/tests/cli/ | ✅ Yes (limited) |

## Historical Note

Previous versions of constellation-typescript had `tests/mcp/client-integration.test.ts` which attempted to test MCP integration by spawning `agentbe-server`. These tests have been archived to `tests/archive-v0.6/` as they were fundamentally flawed in approach.

## See Also

- [MCP-TESTING-STRATEGY.md](../../../MCP-TESTING-STRATEGY.md) - Detailed testing strategy
- [TEST-INFRASTRUCTURE.md](../../../TEST-INFRASTRUCTURE.md) - Complete test infrastructure guide
- [agentbe-server/tests/mcp-servers/](../../../agentbe-server/tests/mcp-servers/) - Actual MCP tests
