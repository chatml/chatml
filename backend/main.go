package main

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"time"

	"github.com/chatml/chatml-backend/app"
	"github.com/chatml/chatml-backend/appdir"
	"github.com/chatml/chatml-backend/logger"
)

const (
	// DefaultPort is the preferred port for the backend server
	DefaultPort = 9876
	// MinPort is the start of the port range for fallback
	MinPort = 9876
	// MaxPort is the end of the port range for fallback
	// NOTE: If you change this range, you must also update the CSP in
	// src-tauri/tauri.conf.json to include all ports in the range.
	// CSP wildcards (localhost:*) are not supported.
	MaxPort = 9899
)

// acquireListener finds an available port, trying the preferred port first,
// then falling back to the range MinPort-MaxPort.
// Returns the listener (caller must close) to avoid TOCTOU race conditions.
func acquireListener(preferred int) (net.Listener, int, error) {
	// Try preferred port first
	if l, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", preferred)); err == nil {
		return l, preferred, nil
	}

	// Try range from MinPort to MaxPort
	for port := MinPort; port <= MaxPort; port++ {
		if port == preferred {
			continue // Already tried
		}
		if l, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port)); err == nil {
			return l, port, nil
		}
	}

	return nil, 0, fmt.Errorf("no available port in range %d-%d", MinPort, MaxPort)
}

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	// Determine preferred port
	preferredPort := DefaultPort
	if p := os.Getenv("PORT"); p != "" {
		if parsed, err := strconv.Atoi(p); err == nil {
			preferredPort = parsed
		}
	}

	// Acquire a listener (tries preferred first, then range)
	listener, actualPort, err := acquireListener(preferredPort)
	if err != nil {
		logger.Main.Fatalf("Failed to acquire port: %v", err)
	}

	// Output port for Tauri to capture - MUST be first output line
	fmt.Printf("CHATML_PORT=%d\n", actualPort)

	appdir.Init()

	// Clean up orphaned temp files from any previous crash
	if removed, failed, err := appdir.CleanupTempDir(); err != nil {
		logger.Main.Warnf("Temp file cleanup: %v", err)
	} else {
		if removed > 0 {
			logger.Main.Infof("Cleaned up %d orphaned temp files", removed)
		}
		if failed > 0 {
			logger.Main.Warnf("Failed to remove %d orphaned temp files", failed)
		}
	}

	// Write port file for external tool discovery
	portFile := filepath.Join(appdir.StateDir(), "backend.port")
	if err := os.WriteFile(portFile, []byte(strconv.Itoa(actualPort)), 0644); err != nil {
		logger.Main.Warnf("Failed to write port file: %v", err)
	} else {
		defer os.Remove(portFile)
	}

	// Initialize and wire all subsystems
	a, err := app.New(ctx, actualPort)
	if err != nil {
		logger.Main.Fatalf("Failed to initialize app: %v", err)
	}
	defer a.Shutdown()

	// Start background goroutines (hub, scheduler, watchers, pre-warm)
	a.Start()

	// Create HTTP server
	srv := &http.Server{
		Handler:     a.HTTPRouter,
		ReadTimeout: 15 * time.Second,
		// NOTE: WriteTimeout is intentionally omitted. Setting it would kill
		// long-lived WebSocket connections that are idle beyond the timeout.
		IdleTimeout: 60 * time.Second,
	}

	go func() {
		logger.Main.Infof("ChatML backend starting on port %d", actualPort)
		if err := srv.Serve(listener); err != nil && err != http.ErrServerClosed {
			logger.Main.Fatalf("Server error: %v", err)
		}
	}()

	// Wait for shutdown signal
	<-ctx.Done()
	logger.Main.Info("Shutdown signal received, stopping server...")

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Main.Errorf("Server shutdown error: %v", err)
	}

	logger.Main.Info("Server stopped")
}
