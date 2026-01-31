# Archived v0.6.x Tests

These test files are from version 0.6.x and test the old architecture:
- `FileSystem` class (removed in v0.7.0)
- `LocalBackend` / `RemoteBackend` (replaced by `LocalFilesystemBackend` / `RemoteFilesystemBackend`)
- `LocalWorkspace` / `RemoteWorkspace` (replaced by scoping API)

They are kept here for reference but are not run in the current test suite.

New tests for v0.7.0 are in:
- `tests/backends/` - Backend class tests
- `tests/scoped/` - Scoped backend tests
- `tests/pooling/` - Connection pooling tests
- `tests/security/` - Security tests
- `tests/mcp/` - MCP integration tests
