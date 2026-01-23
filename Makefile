.PHONY: build build-debug dev backend clean init deps install-debug

# Get the Rust target triple for the current platform
TARGET := $(shell rustc -vV | grep host | cut -d' ' -f2)

# Install npm dependencies if node_modules is missing
deps:
	@if [ ! -d "node_modules" ]; then \
		echo "Installing npm dependencies..."; \
		npm install; \
	fi

# Build Go backend for current platform
backend:
	cd backend && go build -o ../src-tauri/binaries/chatml-backend-$(TARGET)

# Development mode (auto-installs deps if needed)
dev: deps backend
	npm run tauri:dev

# Production build (auto-installs deps if needed)
build: deps backend
	npm run tauri:build

# Debug build (for testing deep links, OAuth, etc.)
# Note: The updater plugin fails without a valid signing key, but we only need the .app bundle
# We capture the exit code and only fail if both the build failed AND no .app was created
build-debug: deps backend
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

# Initialize fresh worktree - explicit setup command
init: deps backend
	@echo "Worktree initialized. Run 'make dev' to start development."

# Clean build artifacts
clean:
	rm -rf src-tauri/binaries/*
	rm -rf src-tauri/target
	rm -rf backend/chatml-backend
	rm -rf out
	rm -rf .next
