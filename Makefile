.PHONY: build dev backend clean

# Get the Rust target triple for the current platform
TARGET := $(shell rustc -vV | grep host | cut -d' ' -f2)

# Build Go backend for current platform
backend:
	cd backend && go build -o ../src-tauri/binaries/chatml-backend-$(TARGET)

# Development mode
dev: backend
	npm run tauri:dev

# Production build
build: backend
	npm run tauri:build

# Clean build artifacts
clean:
	rm -rf src-tauri/binaries/*
	rm -rf src-tauri/target
	rm -rf backend/chatml-backend
	rm -rf out
	rm -rf .next
