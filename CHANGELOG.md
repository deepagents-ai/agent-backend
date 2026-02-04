# Changelog

All notable changes to AgentBackend will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Multi-tenant workspace support with userId-based isolation
- Centralized configuration system via Config class
- WorkspaceManager for automatic user workspace creation
- Default workspace location in system temp directory
- Configuration loading from optional JSON file

### Changed
- LocalBackendConfig now supports optional userId field
- Workspace parameter is now optional when userId is provided
- Enhanced FileSystem constructor to support `new FileSystem({ userId: 'user123' })`

## [0.1.0] - 2024-XX-XX

### Added
- Initial release of AgentBackend
- Local filesystem backend with bash command execution
- Safety features including dangerous command blocking
- Path traversal protection and workspace isolation
- Claude Code adapter for AI integration
- TypeScript support with full type safety
- POSIX-compliant commands for cross-platform compatibility
- Detailed file listings with metadata
- Comprehensive error handling
- Token-aware output limiting
- Extensible backend architecture (stubs for Docker and Remote backends)

### Security
- Built-in protection against dangerous operations
- Workspace boundary enforcement
- Input validation and sanitization

[Unreleased]: https://github.com/agent-backend/agent-backend/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/agent-backend/agent-backend/releases/tag/v0.1.0