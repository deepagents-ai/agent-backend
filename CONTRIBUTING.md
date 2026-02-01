# Contributing to AgentBackend

Thank you for your interest in contributing to AgentBackend! We welcome contributions from everyone, whether you're fixing bugs, adding features, improving documentation, or helping with other aspects of the project.

## Code of Conduct

By participating in this project, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md). Please read it before contributing.

## How to Contribute

### Reporting Issues

Before creating an issue, please:

1. **Search existing issues** to avoid duplicates
2. **Check the documentation** to ensure it's not a usage question
3. **Use the appropriate issue template** when creating new issues

When reporting bugs, please include:
- Clear description of the problem
- Steps to reproduce
- Expected vs actual behavior
- Environment details (Node.js version, OS, etc.)
- Minimal code example if applicable

### Suggesting Features

We welcome feature suggestions! Please:
- Use the feature request template
- Explain the use case and benefit
- Consider implementation complexity
- Be open to discussion and alternatives

## Development Setup

### Prerequisites

- Node.js 18+ 
- npm (comes with Node.js)
- Git

### Local Development

1. **Fork and clone the repository**
   ```bash
   git clone https://github.com/YOUR_USERNAME/agent-backend.git
   cd agent-backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Run tests to ensure everything works**
   ```bash
   npm test
   ```

4. **Build the project**
   ```bash
   npm run build
   ```

### Development Workflow

1. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/your-bug-fix
   ```

2. **Make your changes**
   - Write code following our style guidelines
   - Add tests for new functionality
   - Update documentation as needed

3. **Run quality checks & tests**
   ```bash
   pnpm run typecheck   # Verify TypeScript types
   pnpm run build       # Ensure it builds
   pnpm test --run      # Run tests
   ```

4. **Commit your changes**
   ```bash
   git add .
   git commit -m "feat: add new feature"
   ```

5. **Push and create a pull request**
   ```bash
   git push origin feature/your-feature-name
   ```

## Code Style Guidelines

### TypeScript Standards

- Use TypeScript for all new code
- Prefer explicit types over `any`
- Use interfaces for object shapes
- Export types that might be useful to consumers

### Code Organization

- Keep functions focused and single-purpose
- Use descriptive variable and function names
- Add JSDoc comments for public APIs
- Group related functionality in modules

### Testing

- Write tests for new features and bug fixes
- Prefer unit tests over integration tests
- Use descriptive test names

### Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` new features
- `fix:` bug fixes
- `docs:` documentation changes
- `style:` code style changes (formatting, etc.)
- `refactor:` code refactoring
- `test:` adding or updating tests
- `chore:` maintenance tasks

Examples:
```
feat(agentbe-typescript): add userId-based workspace management
fix(remote): handle edge case in path resolution
docs(agentbe): update README with new examples
```

## Pull Request Process

1. **Ensure your PR**:
   - Has a clear title and description
   - Links to related issues
   - Includes tests for changes
   - Updates documentation if needed
   - Passes all CI checks

2. **PR Review Process**:
   - PRs require at least one review
   - Address feedback promptly
   - Keep discussions constructive
   - Be patient with the review process

3. **After Approval**:
   - PRs are squash-merged to main
   - Delete your feature branch after merge

## Documentation

### Code Documentation

- Use JSDoc for public APIs
- Include parameter and return type information
- Add usage examples for complex functions
- Document any gotchas or limitations

## Release Process

Releases are handled by maintainers:

1. Update version in `package.json`
2. Update `CHANGELOG.md`
3. Create GitHub release
4. Publish to npm

## Getting Help

- **Questions**: Use GitHub Discussions
- **Bugs**: Create an issue with the bug template
- **Features**: Create an issue with the feature template

## Recognition

Contributors are recognized in:
- GitHub contributors list
- Release notes for significant contributions
- Special mentions for ongoing contributors

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing to AgentBackend! 🌟