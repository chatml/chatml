// Package ollama manages the lifecycle of a bundled Ollama binary for local model inference.
// It handles downloading, starting/stopping, health checks, and model management
// so that users don't need to install Ollama separately.
package ollama

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"syscall"
	"time"
)

// PinnedVersion is the Ollama release we download when auto-installing.
// Bump this when we validate a new Ollama release.
const PinnedVersion = "v0.14.1"

// ProgressEvent is emitted during binary download or model pull operations.
type ProgressEvent struct {
	Type       string `json:"type"`       // "ollama_download" or "ollama_pull"
	Status     string `json:"status"`     // human-readable status line
	Model      string `json:"model,omitempty"`
	Percent    int    `json:"percent"`    // 0-100
	Downloaded int64  `json:"downloaded"` // bytes
	Total      int64  `json:"total"`      // bytes
}

// StatusInfo describes the current state of the managed Ollama instance.
type StatusInfo struct {
	Installed bool        `json:"installed"`
	Running   bool        `json:"running"`
	Version   string      `json:"version"`
	Models    []ModelInfo `json:"models"`
}

// ModelInfo describes a locally available model.
type ModelInfo struct {
	Name       string    `json:"name"`
	Size       int64     `json:"size"`
	ModifiedAt time.Time `json:"modified_at"`
}

// Manager handles the full lifecycle of a managed Ollama binary and server.
type Manager struct {
	dataDir string // root directory for ollama state (~/.chatml/ollama or appdir-based)

	mu       sync.Mutex
	cmd      *exec.Cmd
	port     int
	stopping bool            // true while Stop() is in progress — prevents concurrent SIGTERM
	stopCh   chan struct{} // closed when process exits

	// installMu serializes Install() calls. Protected by its own mutex
	// (not m.mu) to avoid holding the main lock during a long download.
	installMu sync.Mutex

	// progressFunc is called during download/pull operations to stream progress.
	// Set once at construction time; safe to leave nil.
	progressFunc func(ProgressEvent)
}

// NewManager creates a new Ollama manager. dataDir is the parent directory
// where ollama binary and models will be stored (e.g., appdir.Root()/ollama).
// progressFunc (optional) is called during download/pull operations to stream progress.
func NewManager(dataDir string, progressFunc ...func(ProgressEvent)) *Manager {
	m := &Manager{dataDir: dataDir}
	if len(progressFunc) > 0 {
		m.progressFunc = progressFunc[0]
	}
	return m
}

// --- Path helpers ---

func (m *Manager) binDir() string   { return filepath.Join(m.dataDir, "bin") }
func (m *Manager) binPath() string  { return filepath.Join(m.binDir(), "ollama") }
func (m *Manager) modelsDir() string { return filepath.Join(m.dataDir, "models") }
func (m *Manager) versionFile() string { return filepath.Join(m.dataDir, "version.json") }

// --- Installation ---

// IsInstalled returns true if the Ollama binary exists at the expected path.
func (m *Manager) IsInstalled() bool {
	_, err := os.Stat(m.binPath())
	return err == nil
}

// InstalledVersion returns the pinned version that was installed, or "" if not installed.
func (m *Manager) InstalledVersion() string {
	data, err := os.ReadFile(m.versionFile())
	if err != nil {
		return ""
	}
	var v struct{ Version string `json:"version"` }
	if json.Unmarshal(data, &v) != nil {
		return ""
	}
	return v.Version
}

// Install downloads and extracts the Ollama binary for the current platform.
// It streams progress via m.progressFunc. Calling Install when already installed
// with the pinned version is a no-op. Concurrent callers are serialized via
// installMu — only the first caller downloads; others block and see the result.
func (m *Manager) Install(ctx context.Context) error {
	// Fast path (lock-free): already installed with the pinned version.
	if m.IsInstalled() && m.InstalledVersion() == PinnedVersion {
		return nil
	}

	m.installMu.Lock()
	defer m.installMu.Unlock()

	// Double-check under lock — another goroutine may have completed the install.
	if m.IsInstalled() && m.InstalledVersion() == PinnedVersion {
		return nil
	}

	return m.doInstall(ctx)
}

// doInstall performs the actual download and extraction (called via installOnce).
func (m *Manager) doInstall(ctx context.Context) error {
	url, err := downloadURL()
	if err != nil {
		return err
	}

	if err := os.MkdirAll(m.binDir(), 0755); err != nil {
		return fmt.Errorf("create bin dir: %w", err)
	}

	log.Printf("ollama: downloading %s from %s", PinnedVersion, url)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("download: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download: HTTP %d", resp.StatusCode)
	}

	total := resp.ContentLength // may be -1

	if err := m.extractBinary(resp.Body, total); err != nil {
		return fmt.Errorf("extract: %w", err)
	}

	// Make binary executable
	if err := os.Chmod(m.binPath(), 0755); err != nil {
		return fmt.Errorf("chmod: %w", err)
	}

	// Write version metadata
	vdata, _ := json.Marshal(struct {
		Version   string `json:"version"`
		Installed string `json:"installed"`
	}{PinnedVersion, time.Now().UTC().Format(time.RFC3339)})
	if err := os.WriteFile(m.versionFile(), vdata, 0644); err != nil {
		log.Printf("ollama: warning: failed to write version file: %v", err)
	}

	log.Printf("ollama: installed %s to %s", PinnedVersion, m.binPath())
	return nil
}

// extractBinary reads a .tgz archive from r and extracts the "ollama" binary.
// For macOS .zip archives, a different extraction path would be needed —
// for now we use the .tgz endpoint which is available for all platforms.
func (m *Manager) extractBinary(r io.Reader, total int64) error {
	pr := &progressReader{r: r, total: total, emit: m.emitDownloadProgress}

	gz, err := gzip.NewReader(pr)
	if err != nil {
		return fmt.Errorf("gzip: %w", err)
	}
	defer gz.Close()

	tr := tar.NewReader(gz)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("tar: %w", err)
		}

		// We only care about the ollama binary (may be at "bin/ollama" or just "ollama")
		base := filepath.Base(hdr.Name)
		if base != "ollama" || hdr.Typeflag != tar.TypeReg {
			continue
		}

		// Write to a temp file first, then atomically rename to the final path.
		// This prevents a partial binary from passing IsInstalled() checks if
		// the process is interrupted mid-write.
		tmp, err := os.CreateTemp(m.binDir(), "ollama-*.tmp")
		if err != nil {
			return fmt.Errorf("create temp file: %w", err)
		}
		tmpPath := tmp.Name()
		if _, err := io.Copy(tmp, tr); err != nil {
			tmp.Close()
			os.Remove(tmpPath)
			return fmt.Errorf("write binary: %w", err)
		}
		tmp.Close()
		if err := os.Rename(tmpPath, m.binPath()); err != nil {
			os.Remove(tmpPath)
			return fmt.Errorf("rename binary: %w", err)
		}
		return nil
	}

	return fmt.Errorf("ollama binary not found in archive")
}

func (m *Manager) emitDownloadProgress(downloaded, total int64) {
	if m.progressFunc == nil {
		return
	}
	pct := 0
	if total > 0 {
		pct = int(downloaded * 100 / total)
	}
	m.progressFunc(ProgressEvent{
		Type:       "ollama_download",
		Status:     "Downloading Ollama runtime...",
		Percent:    pct,
		Downloaded: downloaded,
		Total:      total,
	})
}

// --- Lifecycle ---

// Endpoint returns the HTTP endpoint of the running Ollama server.
// Returns "" if not running.
func (m *Manager) Endpoint() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.port == 0 {
		return ""
	}
	return fmt.Sprintf("http://127.0.0.1:%d", m.port)
}

// IsRunning returns true if the managed Ollama process is alive and healthy.
func (m *Manager) IsRunning() bool {
	m.mu.Lock()
	port := m.port
	cmd := m.cmd
	m.mu.Unlock()

	if cmd == nil || port == 0 {
		return false
	}

	// Quick health check
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf("http://127.0.0.1:%d/api/tags", port), nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return false
	}
	resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}

// IsAlive returns true if the managed process handle exists and hasn't exited.
// This is a cheap, lock-only check (no HTTP call) suitable for fast-path
// decisions where a full health check is not needed.
func (m *Manager) IsAlive() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.cmd != nil && m.cmd.Process != nil && m.cmd.ProcessState == nil && m.port != 0
}

// EnsureRunning starts Ollama if it isn't already running. Idempotent.
// Uses an optimistic check under lock (process handle alive?) followed by an
// unlocked HTTP health check. If unhealthy, falls through to Start() which
// re-validates under its own lock, so concurrent callers cannot double-start.
func (m *Manager) EnsureRunning(ctx context.Context) error {
	m.mu.Lock()
	// Fast path: process handle exists and hasn't exited
	if m.cmd != nil && m.cmd.Process != nil && m.cmd.ProcessState == nil {
		m.mu.Unlock()
		// Verify actually healthy (unlocked — does HTTP call)
		if m.IsRunning() {
			return nil
		}
		// Process exists but isn't healthy — fall through to Start which re-acquires lock
	} else {
		m.mu.Unlock()
	}
	return m.Start(ctx)
}

// Start spawns the Ollama server process on a random available port.
// Retries up to 3 times to handle transient port-binding races (TOCTOU between
// findFreePort and Ollama's bind).
func (m *Manager) Start(ctx context.Context) error {
	const maxRetries = 3
	var lastErr error
	for attempt := range maxRetries {
		if err := m.tryStart(ctx); err != nil {
			lastErr = err
			log.Printf("ollama: start attempt %d/%d failed: %v", attempt+1, maxRetries, err)
			continue
		}
		return nil
	}
	return fmt.Errorf("ollama: failed after %d attempts: %w", maxRetries, lastErr)
}

// tryStart is the single-attempt implementation of Start.
func (m *Manager) tryStart(ctx context.Context) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Already running — recheck under lock in case another goroutine started it
	if m.cmd != nil && m.cmd.Process != nil {
		if m.cmd.ProcessState == nil { // hasn't exited
			return nil
		}
	}

	if !m.IsInstalled() {
		return fmt.Errorf("ollama: binary not installed, call Install() first")
	}

	port, err := findFreePort()
	if err != nil {
		return fmt.Errorf("find free port: %w", err)
	}

	// Ensure models directory exists
	if err := os.MkdirAll(m.modelsDir(), 0755); err != nil {
		return fmt.Errorf("create models dir: %w", err)
	}

	// Use exec.Command (NOT CommandContext) — the Ollama server must outlive
	// the HTTP request that triggered it. Lifecycle is managed by Stop().
	// The passed ctx is only used for the health-check wait below.
	cmd := exec.Command(m.binPath(), "serve")
	cmd.Env = append(os.Environ(),
		fmt.Sprintf("OLLAMA_HOST=127.0.0.1:%d", port),
		fmt.Sprintf("OLLAMA_MODELS=%s", m.modelsDir()),
		"OLLAMA_NOPRUNE=1",    // Don't auto-prune models
		"OLLAMA_KEEP_ALIVE=5m", // Keep model loaded for 5 minutes
	)
	// Discard Ollama output to avoid interfering with Tauri IPC on stdout.
	// TODO: capture to a log file for debugging.
	cmd.Stdout = io.Discard
	cmd.Stderr = io.Discard

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start ollama: %w", err)
	}

	m.cmd = cmd
	m.port = port
	m.stopCh = make(chan struct{})

	// Wait for server to become healthy BEFORE starting the monitor goroutine.
	// This avoids a double cmd.Wait() race if the health check fails and we
	// need to kill the process synchronously.
	if err := m.waitForHealthy(ctx, port); err != nil {
		// No monitor goroutine is running yet, so we can safely Wait here.
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		m.cmd = nil
		m.port = 0
		close(m.stopCh)
		return fmt.Errorf("ollama failed to start: %w", err)
	}

	// Monitor process exit in background (only after successful startup)
	go func() {
		_ = cmd.Wait()
		m.mu.Lock()
		m.cmd = nil
		m.port = 0
		close(m.stopCh)
		m.mu.Unlock()
		log.Printf("ollama: process exited")
	}()

	log.Printf("ollama: server started on port %d", port)
	return nil
}

// Stop gracefully shuts down the Ollama server.
// Uses the monitor goroutine's stopCh to coordinate shutdown — avoids
// a double cmd.Wait() race by releasing mu before waiting.
func (m *Manager) Stop() error {
	m.mu.Lock()

	if m.cmd == nil || m.cmd.Process == nil || m.stopping {
		m.mu.Unlock()
		return nil
	}

	m.stopping = true
	log.Printf("ollama: stopping server (pid %d)", m.cmd.Process.Pid)

	// Try graceful shutdown first
	if err := m.cmd.Process.Signal(syscall.SIGTERM); err != nil {
		log.Printf("ollama: SIGTERM failed: %v, killing", err)
		_ = m.cmd.Process.Kill()
	}

	// Capture stopCh before releasing mu — the monitor goroutine (from Start)
	// will close it after cmd.Wait() returns. We must release mu so the monitor
	// goroutine can acquire it to perform cleanup.
	stopCh := m.stopCh
	m.mu.Unlock()

	// Wait for the monitor goroutine to reap the process and clean up.
	select {
	case <-stopCh:
	case <-time.After(5 * time.Second):
		// Force kill — re-acquire lock to access cmd safely
		m.mu.Lock()
		if m.cmd != nil && m.cmd.Process != nil {
			log.Printf("ollama: force killing after timeout")
			_ = m.cmd.Process.Kill()
		}
		m.mu.Unlock()
		<-stopCh // monitor goroutine will finish now
	}

	m.mu.Lock()
	m.stopping = false
	m.mu.Unlock()

	return nil
}

func (m *Manager) waitForHealthy(ctx context.Context, port int) error {
	deadline := time.After(30 * time.Second)
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()

	url := fmt.Sprintf("http://127.0.0.1:%d/api/tags", port)
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-deadline:
			return fmt.Errorf("timeout waiting for ollama to start on port %d", port)
		case <-ticker.C:
			reqCtx, cancel := context.WithTimeout(ctx, 1*time.Second)
			req, _ := http.NewRequestWithContext(reqCtx, http.MethodGet, url, nil)
			resp, err := http.DefaultClient.Do(req)
			cancel()
			if err == nil {
				resp.Body.Close()
				if resp.StatusCode == http.StatusOK {
					return nil
				}
			}
		}
	}
}

// TouchActivity is a no-op. Once started, Ollama stays running until ChatML exits.
// The method is retained to satisfy the OllamaManager interface.
func (m *Manager) TouchActivity() {}

// --- Model Management ---

// ListModels returns the locally available models.
func (m *Manager) ListModels(ctx context.Context) ([]ModelInfo, error) {
	endpoint := m.Endpoint()
	if endpoint == "" {
		return nil, fmt.Errorf("ollama not running")
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint+"/api/tags", nil)
	if err != nil {
		return nil, err
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("list models: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		Models []struct {
			Name       string    `json:"name"`
			Size       int64     `json:"size"`
			ModifiedAt time.Time `json:"modified_at"`
		} `json:"models"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	models := make([]ModelInfo, len(result.Models))
	for i, m := range result.Models {
		models[i] = ModelInfo{
			Name:       m.Name,
			Size:       m.Size,
			ModifiedAt: m.ModifiedAt,
		}
	}
	return models, nil
}

// IsModelAvailable checks whether a specific model is pulled locally.
// Uses Ollama's /api/show endpoint to check a single model directly,
// avoiding the overhead of listing and decoding all models.
func (m *Manager) IsModelAvailable(ctx context.Context, model string) (bool, error) {
	endpoint := m.Endpoint()
	if endpoint == "" {
		return false, fmt.Errorf("ollama not running")
	}

	body, _ := json.Marshal(map[string]string{"name": model})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint+"/api/show", bytes.NewReader(body))
	if err != nil {
		return false, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return false, fmt.Errorf("show model: %w", err)
	}
	defer resp.Body.Close()
	// Drain body to allow connection reuse
	io.Copy(io.Discard, io.LimitReader(resp.Body, 16*1024))

	// 200 = model exists, 404 = not found
	if resp.StatusCode == http.StatusOK {
		return true, nil
	}
	if resp.StatusCode == http.StatusNotFound {
		return false, nil
	}
	return false, fmt.Errorf("show model: HTTP %d", resp.StatusCode)
}

// Pull downloads a model. It streams progress via m.progressFunc.
func (m *Manager) Pull(ctx context.Context, model string) error {
	endpoint := m.Endpoint()
	if endpoint == "" {
		return fmt.Errorf("ollama not running")
	}

	body, _ := json.Marshal(map[string]interface{}{
		"name":   model,
		"stream": true,
	})

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint+"/api/pull", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("pull request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("pull: HTTP %d", resp.StatusCode)
	}

	// Stream NDJSON progress
	decoder := json.NewDecoder(resp.Body)
	for decoder.More() {
		var event struct {
			Status    string `json:"status"`
			Digest    string `json:"digest"`
			Total     int64  `json:"total"`
			Completed int64  `json:"completed"`
			Error     string `json:"error"`
		}
		if err := decoder.Decode(&event); err != nil {
			if err == io.EOF {
				break
			}
			return fmt.Errorf("decode pull event: %w", err)
		}

		if event.Error != "" {
			return fmt.Errorf("pull error: %s", event.Error)
		}

		if m.progressFunc != nil {
			pct := 0
			if event.Total > 0 {
				pct = int(event.Completed * 100 / event.Total)
			}
			m.progressFunc(ProgressEvent{
				Type:       "ollama_pull",
				Status:     event.Status,
				Model:      model,
				Percent:    pct,
				Downloaded: event.Completed,
				Total:      event.Total,
			})
		}
	}

	log.Printf("ollama: pulled model %s", model)
	return nil
}

// EnsureModelAvailable checks if a model is available and pulls it if not.
// model can be either a ChatML model ID (e.g., "gemma-4-27b") or an Ollama
// model tag (e.g., "gemma4:27b") — it is normalized before use.
func (m *Manager) EnsureModelAvailable(ctx context.Context, model string) error {
	ollamaName := ToOllamaName(model)
	available, err := m.IsModelAvailable(ctx, ollamaName)
	if err != nil {
		return err
	}
	if available {
		return nil
	}
	return m.Pull(ctx, ollamaName)
}

// Status returns the current state of the Ollama installation and server.
func (m *Manager) Status(ctx context.Context) StatusInfo {
	info := StatusInfo{
		Installed: m.IsInstalled(),
		Version:   m.InstalledVersion(),
		Running:   m.IsRunning(),
	}

	if info.Running {
		if models, err := m.ListModels(ctx); err == nil {
			info.Models = models
		}
	}

	return info
}

// --- Helpers ---

// downloadURL returns the appropriate download URL for the current platform.
func downloadURL() (string, error) {
	goos := runtime.GOOS
	arch := runtime.GOARCH

	var platform string
	switch {
	case goos == "darwin" && arch == "arm64":
		platform = "darwin-arm64"
	case goos == "darwin" && arch == "amd64":
		platform = "darwin-amd64"
	case goos == "linux" && arch == "amd64":
		platform = "linux-amd64"
	case goos == "linux" && arch == "arm64":
		platform = "linux-arm64"
	default:
		return "", fmt.Errorf("unsupported platform: %s/%s", goos, arch)
	}

	// Use .tgz format — available for all platforms and easy to extract
	return fmt.Sprintf("https://github.com/ollama/ollama/releases/download/%s/ollama-%s.tgz", PinnedVersion, platform), nil
}

// findFreePort asks the OS for an available TCP port.
func findFreePort() (int, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	port := l.Addr().(*net.TCPAddr).Port
	l.Close()
	return port, nil
}

// progressReader wraps an io.Reader to report download progress.
type progressReader struct {
	r          io.Reader
	total      int64
	downloaded int64
	lastEmit   time.Time
	emit       func(downloaded, total int64)
}

func (pr *progressReader) Read(p []byte) (int, error) {
	n, err := pr.r.Read(p)
	pr.downloaded += int64(n)
	// Emit at most every 100ms to avoid flooding
	if pr.emit != nil && time.Since(pr.lastEmit) > 100*time.Millisecond {
		pr.emit(pr.downloaded, pr.total)
		pr.lastEmit = time.Now()
	}
	return n, err
}
