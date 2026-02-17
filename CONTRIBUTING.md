# Contributing to Agent Backend

## Code of Conduct

By participating in this project, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

## How to Contribute

### Reporting Issues

Before creating an issue, search existing issues to avoid duplicates. When reporting bugs, include:

- Steps to reproduce
- Expected vs actual behavior
- Environment details (Node.js version, OS)
- Minimal code example if applicable

### Suggesting Features

Use the feature request template. Explain the use case, the expected benefit, and be open to alternatives.

## Development Setup

### Prerequisites

- Node.js 18+
- pnpm
- Git
- Docker (optional, for remote backend testing)

### Initial Setup

1. Fork and clone the repository:

   ```bash
   git clone https://github.com/YOUR_USERNAME/agent-backend.git
   cd agent-backend
   ```

2. Install dependencies:

   ```bash
   make install
   ```

   This installs pnpm packages, Python packages (if available), and [mprocs](https://github.com/pvolok/mprocs).

3. Start the dev environment:

   ```bash
   make dev
   ```

   This launches the Docker-based remote daemon and TypeScript watch via the mprocs TUI. If Docker is not installed, it falls back to local mode automatically.

### Development Mode

| Command          | Description                                           |
|------------------|-------------------------------------------------------|
| `make dev`       | Docker daemon + TypeScript watch (default)            |
| `make dev-local` | Local daemon only, no Docker                          |

Both commands launch [mprocs](https://github.com/pvolok/mprocs), a terminal UI for managing multiple processes.

**mprocs TUI shortcuts:**

| Key             | Action           |
|-----------------|------------------|
| `Tab`/`Shift+Tab` | Cycle processes |
| `r`             | Restart process  |
| `f`             | Focus (full screen) |
| `Space`         | Start/stop process |
| `q`             | Quit             |

### Common Commands

| Command          | Description                   |
|------------------|-------------------------------|
| `make help`      | Show all available commands   |
| `make dev`       | Start dev environment (Docker daemon) |
| `make dev-local` | Start dev environment (local only) |
| `make build`     | Build all packages            |
| `make test`      | Run all tests                 |
| `make typecheck` | Type check all packages       |
| `make lint`      | Lint all packages             |
| `make ci`        | Full CI pipeline              |

Language-specific commands use the pattern `make <command>-<language>`, for example `make build-typescript` or `make test-python`.

### Language-Specific Docs

- [TypeScript](./docs/typescript.md) -- package info, testing, code style, workflows, troubleshooting
- [Python](./docs/python.md) -- build, test, lint commands

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

| Prefix      | Purpose                    |
|-------------|----------------------------|
| `feat:`     | New features               |
| `fix:`      | Bug fixes                  |
| `docs:`     | Documentation changes      |
| `style:`    | Formatting, no logic changes |
| `refactor:` | Code restructuring         |
| `test:`     | Adding or updating tests   |
| `chore:`    | Maintenance tasks          |

Examples:

```
feat(agentbe-typescript): add userId-based workspace management
fix(remote): handle edge case in path resolution
docs: update README with new examples
```

## Release Process

Releases are handled by maintainers via:

```bash
./manage.sh publish
```

This bumps the version (patch/minor/major), builds the package, publishes to npm, commits the version change, creates a git tag, and pushes to GitHub.

## License

By contributing, you agree that your contributions will be licensed under the [Apache 2.0 License](LICENSE).
