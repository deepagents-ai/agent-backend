.PHONY: help install build test typecheck lint clean dev publish

# Default target - show help
.DEFAULT_GOAL := help

# Colors for output
CYAN := \033[0;36m
RESET := \033[0m

##@ General

help: ## Show this help message
	@echo 'Usage: make [target]'
	@echo ''
	@awk 'BEGIN {FS = ":.*##"; printf "Available targets:\n"} /^[a-zA-Z_-]+:.*?##/ { printf "  $(CYAN)%-15s$(RESET) %s\n", $$1, $$2 } /^##@/ { printf "\n%s\n", substr($$0, 5) } ' $(MAKEFILE_LIST)

##@ Dependencies

install: ## Install all dependencies (TypeScript + Python)
	@echo "Installing TypeScript dependencies..."
	pnpm install
	@echo ""
	@echo "Installing Python dependencies..."
	@if [ -d "python" ]; then \
		cd python && pip install -e .[dev]; \
	else \
		echo "Python package not found (will be added later)"; \
	fi

##@ Build

build: build-typescript build-python ## Build all packages

build-typescript: ## Build TypeScript packages only
	@echo "Building TypeScript packages..."
	pnpm -r build

build-python: ## Build Python package only
	@echo "Building Python package..."
	@if [ -d "python" ]; then \
		cd python && python -m build; \
	else \
		echo "Python package not found (skipping)"; \
	fi

##@ Testing

test: test-typescript test-python ## Run all tests

test-typescript: ## Run TypeScript tests only
	@echo "Running TypeScript tests..."
	pnpm -r test

test-python: ## Run Python tests only
	@echo "Running Python tests..."
	@if [ -d "python" ]; then \
		cd python && pytest; \
	else \
		echo "Python package not found (skipping)"; \
	fi

test-unit: ## Run unit tests only
	@echo "Running TypeScript unit tests..."
	pnpm -r test:unit

test-integration: ## Run integration tests
	@echo "Running integration tests..."
	cd remote && pnpm run test:integration

##@ Type Checking & Linting

typecheck: typecheck-typescript typecheck-python ## Run type checking for all packages

typecheck-typescript: ## Type check TypeScript packages only
	@echo "Type checking TypeScript packages..."
	pnpm -r typecheck

typecheck-python: ## Type check Python package only
	@echo "Type checking Python package..."
	@if [ -d "python" ]; then \
		cd python && mypy .; \
	else \
		echo "Python package not found (skipping)"; \
	fi

lint: lint-typescript lint-python ## Lint all packages

lint-typescript: ## Lint TypeScript packages only
	@echo "Linting TypeScript packages..."
	pnpm -r lint

lint-python: ## Lint Python package only
	@echo "Linting Python package..."
	@if [ -d "python" ]; then \
		cd python && ruff check .; \
	else \
		echo "Python package not found (skipping)"; \
	fi

lint-fix: ## Auto-fix linting issues
	@echo "Auto-fixing TypeScript..."
	pnpm -r lint:fix || true
	@echo "Auto-fixing Python..."
	@if [ -d "python" ]; then \
		cd python && ruff check --fix .; \
	fi

##@ Development

dev: ## Start development mode (watch mode)
	pnpm -r --parallel dev

clean: ## Clean build artifacts and dependencies
	@echo "Cleaning TypeScript packages..."
	rm -rf typescript/dist typescript/node_modules
	rm -rf remote/dist remote/node_modules
	rm -rf node_modules
	@echo "Cleaning Python package..."
	@if [ -d "python" ]; then \
		cd python && rm -rf dist build *.egg-info .pytest_cache .mypy_cache __pycache__; \
	fi
	@echo "Cleaning lockfiles..."
	rm -f pnpm-lock.yaml

##@ Publishing & Deployment

publish-typescript: ## Publish TypeScript package to npm
	@echo "Publishing TypeScript package..."
	./manage.sh publish

publish-python: ## Publish Python package to PyPI
	@echo "Publishing Python package..."
	@if [ -d "python" ]; then \
		cd python && python -m twine upload dist/*; \
	else \
		echo "Python package not found"; \
	fi

start-deploy-ui: ## Start deployment UI for cloud VM setup
	./manage.sh start-deploy-ui

##@ Continuous Integration

ci: install typecheck lint test ## Run full CI pipeline (install, typecheck, lint, test)

ci-fast: typecheck test-unit ## Run fast CI checks (typecheck + unit tests only)
