.PHONY: build build-debug dev backend agent-runner clean init deps install-debug test test-cover test-cover-html release release-tag

# Load .env file if it exists (for OAuth credentials, API keys)
-include .env
export

# Get the Rust target triple for the current platform
TARGET := $(shell rustc -vV | grep host | cut -d' ' -f2)

# Install npm dependencies if node_modules is missing
deps:
	@if [ ! -d "node_modules" ]; then \
		echo "Installing npm dependencies..."; \
		npm install; \
	fi

# Build Go backend for current platform (development - uses env vars at runtime)
backend:
	cd backend && go build -o ../src-tauri/binaries/chatml-backend-$(TARGET)

# Build agent-runner TypeScript
agent-runner:
	cd agent-runner && npm install && npm run build

# Development mode (auto-installs deps if needed)
# Trap SIGINT/SIGTERM to kill all child processes in the process group
# Note: .env file is auto-loaded and exported (see -include .env above)
dev: deps backend agent-runner
	@trap 'kill 0' INT TERM; npm run tauri:dev & wait

# Production build for local dev testing (no signing — use CI for distributable builds)
build: deps backend agent-runner
	npm run tauri:build

# Debug build (for testing deep links, OAuth, etc.)
# Note: The updater plugin fails without a valid signing key, but we only need the .app bundle
# We capture the exit code and only fail if both the build failed AND no .app was created
build-debug: deps backend agent-runner
	@npm run tauri build -- --debug --bundles app; \
	BUILD_EXIT=$$?; \
	if [ ! -d src-tauri/target/debug/bundle/macos/chatml.app ]; then \
		echo "Build failed - .app not created"; \
		exit 1; \
	fi; \
	if [ $$BUILD_EXIT -ne 0 ]; then \
		echo "Note: Build completed with warnings (exit code $$BUILD_EXIT), but .app bundle was created successfully"; \
	fi

# Install debug build to /Applications (enables deep link testing)
install-debug: build-debug
	@echo "Installing debug build to /Applications..."
	@rm -rf /Applications/chatml.app
	@cp -r src-tauri/target/debug/bundle/macos/chatml.app /Applications/
	@echo "Installed! Run 'open /Applications/chatml.app' to test deep links"

# Prepare a release: bumps version, creates a PR. After merge, tag main to trigger CI.
# Step 1: make release VERSION=0.2.0        → creates branch + PR
# Step 2: merge the PR on GitHub
# Step 3: make release-tag VERSION=0.2.0    → tags main and pushes to trigger CI
release:
	@if [ -z "$(VERSION)" ]; then echo "Usage: make release VERSION=x.y.z"; exit 1; fi
	git checkout main && git pull origin main
	git checkout -b release/v$(VERSION)
	@echo "Bumping version to $(VERSION)..."
	@sed -i '' 's/"version": "[^"]*"/"version": "$(VERSION)"/' package.json
	@sed -i '' '/"version":/{s/"version": "[^"]*"/"version": "$(VERSION)"/;};' src-tauri/tauri.conf.json
	@sed -i '' '/^\[package\]/,/^\[/{s/^version = "[^"]*"/version = "$(VERSION)"/;}' src-tauri/Cargo.toml
	npm install --package-lock-only
	git add package.json package-lock.json src-tauri/tauri.conf.json src-tauri/Cargo.toml
	git commit -m "release: v$(VERSION)"
	git push -u origin release/v$(VERSION)
	gh pr create --title "release: v$(VERSION)" --body "Bump version to $(VERSION)."
	@echo "PR created. Merge it, then run: make release-tag VERSION=$(VERSION)"

# Tag main after the release PR is merged — triggers CI build + publish
release-tag:
	@if [ -z "$(VERSION)" ]; then echo "Usage: make release-tag VERSION=x.y.z"; exit 1; fi
	git checkout main && git pull origin main
	git tag "v$(VERSION)"
	git push origin "v$(VERSION)"
	@echo "Tag v$(VERSION) pushed. CI will build and publish."

# Initialize fresh worktree - explicit setup command
init: deps backend agent-runner
	@echo "Worktree initialized. Run 'make dev' to start development."

# Run Go backend tests
test:
	cd backend && go test -race ./...

# Run Go backend tests with coverage report
test-cover:
	cd backend && go test -race -coverprofile=coverage.out -covermode=atomic ./...
	cd backend && go tool cover -func=coverage.out | tail -1

# Generate HTML coverage report
test-cover-html: test-cover
	cd backend && go tool cover -html=coverage.out -o coverage.html
	@echo "Coverage report: backend/coverage.html"

# Clean build artifacts
clean:
	rm -rf src-tauri/binaries/*
	rm -rf src-tauri/target
	rm -rf backend/chatml-backend
	rm -rf out
	rm -rf .next
	rm -rf agent-runner/dist
	rm -rf agent-runner/node_modules
