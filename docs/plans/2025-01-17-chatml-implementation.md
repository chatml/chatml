# ChatML MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a macOS app that orchestrates multiple Claude Code agents working in parallel on isolated git worktrees.

**Architecture:** Tauri shell spawns a Go sidecar backend. Go manages agent processes and git worktrees, streaming output via WebSocket to a Next.js frontend.

**Tech Stack:** Tauri 2.0, Next.js 14+, Go 1.22+, WebSocket, Zustand, Tailwind CSS

---

## Phase 1: Project Foundation

### Task 1: Initialize Tauri + Next.js Project

**Files:**
- Create: `package.json`
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/src/main.rs`
- Create: `src/app/layout.tsx`
- Create: `src/app/page.tsx`

**Step 1: Create Next.js project with Tauri**

Run:
```bash
npm create tauri-app@latest . -- --template next --manager npm
```

Select: Next.js, TypeScript, Tailwind CSS when prompted.

**Step 2: Verify project structure exists**

Run:
```bash
ls -la src-tauri/src/main.rs src/app/page.tsx
```

Expected: Both files exist.

**Step 3: Install dependencies**

Run:
```bash
npm install
```

Expected: `node_modules` created, no errors.

**Step 4: Test dev mode**

Run:
```bash
npm run tauri dev
```

Expected: Tauri window opens with Next.js default page.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: initialize Tauri + Next.js project"
```

---

### Task 2: Initialize Go Backend

**Files:**
- Create: `backend/go.mod`
- Create: `backend/main.go`
- Create: `backend/server/router.go`

**Step 1: Initialize Go module**

Run:
```bash
mkdir -p backend && cd backend && go mod init github.com/chatml/chatml-backend
```

Expected: `backend/go.mod` created.

**Step 2: Install dependencies**

Run:
```bash
cd backend && go get github.com/go-chi/chi/v5 github.com/gorilla/websocket github.com/rs/cors
```

Expected: Dependencies added to `go.mod`.

**Step 3: Create main.go**

Create `backend/main.go`:
```go
package main

import (
	"log"
	"net/http"
	"os"

	"github.com/chatml/chatml-backend/server"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "9876"
	}

	router := server.NewRouter()

	log.Printf("ChatML backend starting on port %s", port)
	if err := http.ListenAndServe(":"+port, router); err != nil {
		log.Fatal(err)
	}
}
```

**Step 4: Create router.go**

Create `backend/server/router.go`:
```go
package server

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/rs/cors"
)

func NewRouter() http.Handler {
	r := chi.NewRouter()

	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})

	handler := cors.New(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"*"},
		AllowCredentials: true,
	}).Handler(r)

	return handler
}
```

**Step 5: Build and test backend**

Run:
```bash
cd backend && go build -o chatml-backend && ./chatml-backend &
curl http://localhost:9876/health
pkill chatml-backend
```

Expected: `{"status":"ok"}`

**Step 6: Commit**

```bash
git add backend/
git commit -m "feat: initialize Go backend with health endpoint"
```

---

### Task 3: Configure Tauri Sidecar

**Files:**
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/src/main.rs`
- Create: `src-tauri/capabilities/default.json`
- Create: `Makefile`

**Step 1: Create Makefile**

Create `Makefile`:
```makefile
.PHONY: build dev backend clean

# Build Go backend for current platform
backend:
	cd backend && go build -o ../src-tauri/binaries/chatml-backend-$(shell rustc -vV | grep host | cut -d' ' -f2)

# Development mode
dev: backend
	npm run tauri dev

# Production build
build: backend
	npm run tauri build

# Clean build artifacts
clean:
	rm -rf src-tauri/binaries/*
	rm -rf backend/chatml-backend
```

**Step 2: Create binaries directory**

Run:
```bash
mkdir -p src-tauri/binaries
```

**Step 3: Update tauri.conf.json**

Modify `src-tauri/tauri.conf.json` to add sidecar config. Find the `"bundle"` section and add:
```json
{
  "bundle": {
    "externalBin": [
      "binaries/chatml-backend"
    ]
  }
}
```

Also ensure `"shell"` permissions in the `"plugins"` section:
```json
{
  "plugins": {
    "shell": {
      "sidecar": true,
      "scope": [
        {
          "name": "binaries/chatml-backend",
          "sidecar": true
        }
      ]
    }
  }
}
```

**Step 4: Update main.rs to spawn sidecar**

Modify `src-tauri/src/main.rs`:
```rust
use tauri::Manager;
use tauri_plugin_shell::ShellExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let sidecar_command = app.shell().sidecar("chatml-backend").unwrap();
            let (mut _rx, mut _child) = sidecar_command.spawn().expect("Failed to spawn sidecar");

            println!("ChatML backend sidecar started");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

**Step 5: Add shell plugin to Cargo.toml**

Add to `src-tauri/Cargo.toml` dependencies:
```toml
tauri-plugin-shell = "2"
```

**Step 6: Build and test**

Run:
```bash
make dev
```

Expected: App launches, console shows "ChatML backend sidecar started", health endpoint responds.

**Step 7: Commit**

```bash
git add Makefile src-tauri/
git commit -m "feat: configure Tauri to spawn Go sidecar"
```

---

## Phase 2: Git Operations

### Task 4: Implement Repository Model

**Files:**
- Create: `backend/models/types.go`
- Create: `backend/git/repo.go`
- Create: `backend/store/store.go`

**Step 1: Create types.go**

Create `backend/models/types.go`:
```go
package models

import "time"

type Repo struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Path      string    `json:"path"`
	Branch    string    `json:"branch"`
	CreatedAt time.Time `json:"createdAt"`
}

type Agent struct {
	ID        string    `json:"id"`
	RepoID    string    `json:"repoId"`
	Task      string    `json:"task"`
	Status    string    `json:"status"` // pending, running, done, error
	Worktree  string    `json:"worktree"`
	Branch    string    `json:"branch"`
	CreatedAt time.Time `json:"createdAt"`
}

type AgentStatus string

const (
	StatusPending AgentStatus = "pending"
	StatusRunning AgentStatus = "running"
	StatusDone    AgentStatus = "done"
	StatusError   AgentStatus = "error"
)
```

**Step 2: Create store.go (in-memory store)**

Create `backend/store/store.go`:
```go
package store

import (
	"sync"

	"github.com/chatml/chatml-backend/models"
)

type Store struct {
	mu     sync.RWMutex
	repos  map[string]*models.Repo
	agents map[string]*models.Agent
}

func New() *Store {
	return &Store{
		repos:  make(map[string]*models.Repo),
		agents: make(map[string]*models.Agent),
	}
}

func (s *Store) AddRepo(repo *models.Repo) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.repos[repo.ID] = repo
}

func (s *Store) GetRepo(id string) *models.Repo {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.repos[id]
}

func (s *Store) ListRepos() []*models.Repo {
	s.mu.RLock()
	defer s.mu.RUnlock()
	repos := make([]*models.Repo, 0, len(s.repos))
	for _, r := range s.repos {
		repos = append(repos, r)
	}
	return repos
}

func (s *Store) DeleteRepo(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.repos, id)
}

func (s *Store) AddAgent(agent *models.Agent) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.agents[agent.ID] = agent
}

func (s *Store) GetAgent(id string) *models.Agent {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.agents[id]
}

func (s *Store) ListAgents(repoID string) []*models.Agent {
	s.mu.RLock()
	defer s.mu.RUnlock()
	agents := make([]*models.Agent, 0)
	for _, a := range s.agents {
		if a.RepoID == repoID {
			agents = append(agents, a)
		}
	}
	return agents
}

func (s *Store) UpdateAgentStatus(id string, status models.AgentStatus) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if agent, ok := s.agents[id]; ok {
		agent.Status = string(status)
	}
}
```

**Step 3: Create git/repo.go**

Create `backend/git/repo.go`:
```go
package git

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

type RepoManager struct{}

func NewRepoManager() *RepoManager {
	return &RepoManager{}
}

func (rm *RepoManager) ValidateRepo(path string) error {
	gitDir := filepath.Join(path, ".git")
	if _, err := os.Stat(gitDir); os.IsNotExist(err) {
		return fmt.Errorf("not a git repository: %s", path)
	}
	return nil
}

func (rm *RepoManager) GetCurrentBranch(repoPath string) (string, error) {
	cmd := exec.Command("git", "rev-parse", "--abbrev-ref", "HEAD")
	cmd.Dir = repoPath
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

func (rm *RepoManager) GetRepoName(path string) string {
	return filepath.Base(path)
}
```

**Step 4: Test Go build**

Run:
```bash
cd backend && go build ./...
```

Expected: No errors.

**Step 5: Commit**

```bash
git add backend/
git commit -m "feat: add repository and agent models with in-memory store"
```

---

### Task 5: Implement Worktree Management

**Files:**
- Create: `backend/git/worktree.go`

**Step 1: Create worktree.go**

Create `backend/git/worktree.go`:
```go
package git

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

type WorktreeManager struct{}

func NewWorktreeManager() *WorktreeManager {
	return &WorktreeManager{}
}

func (wm *WorktreeManager) Create(repoPath, agentID string) (worktreePath string, branchName string, err error) {
	worktreesDir := filepath.Join(repoPath, ".worktrees")
	if err := os.MkdirAll(worktreesDir, 0755); err != nil {
		return "", "", fmt.Errorf("failed to create worktrees dir: %w", err)
	}

	branchName = fmt.Sprintf("agent/%s", agentID)
	worktreePath = filepath.Join(worktreesDir, agentID)

	cmd := exec.Command("git", "worktree", "add", "-b", branchName, worktreePath)
	cmd.Dir = repoPath
	if out, err := cmd.CombinedOutput(); err != nil {
		return "", "", fmt.Errorf("failed to create worktree: %s: %w", string(out), err)
	}

	return worktreePath, branchName, nil
}

func (wm *WorktreeManager) Remove(repoPath, agentID string) error {
	worktreePath := filepath.Join(repoPath, ".worktrees", agentID)

	// Remove the worktree
	cmd := exec.Command("git", "worktree", "remove", worktreePath, "--force")
	cmd.Dir = repoPath
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("failed to remove worktree: %s: %w", string(out), err)
	}

	// Delete the branch
	branchName := fmt.Sprintf("agent/%s", agentID)
	cmd = exec.Command("git", "branch", "-D", branchName)
	cmd.Dir = repoPath
	cmd.CombinedOutput() // Ignore error, branch might not exist

	return nil
}

func (wm *WorktreeManager) List(repoPath string) ([]string, error) {
	cmd := exec.Command("git", "worktree", "list", "--porcelain")
	cmd.Dir = repoPath
	out, err := cmd.Output()
	if err != nil {
		return nil, err
	}

	var worktrees []string
	for _, line := range strings.Split(string(out), "\n") {
		if strings.HasPrefix(line, "worktree ") {
			path := strings.TrimPrefix(line, "worktree ")
			if strings.Contains(path, ".worktrees") {
				worktrees = append(worktrees, path)
			}
		}
	}
	return worktrees, nil
}

func (wm *WorktreeManager) GetDiff(repoPath, agentID string) (string, error) {
	branchName := fmt.Sprintf("agent/%s", agentID)

	// Get the base branch
	cmd := exec.Command("git", "rev-parse", "--abbrev-ref", "HEAD")
	cmd.Dir = repoPath
	baseOut, err := cmd.Output()
	if err != nil {
		return "", err
	}
	baseBranch := strings.TrimSpace(string(baseOut))

	// Get diff
	cmd = exec.Command("git", "diff", baseBranch+"..."+branchName)
	cmd.Dir = repoPath
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}

	return string(out), nil
}

func (wm *WorktreeManager) Merge(repoPath, agentID string) error {
	branchName := fmt.Sprintf("agent/%s", agentID)

	cmd := exec.Command("git", "merge", branchName, "--no-edit")
	cmd.Dir = repoPath
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("merge failed: %s: %w", string(out), err)
	}

	return nil
}
```

**Step 2: Test Go build**

Run:
```bash
cd backend && go build ./...
```

Expected: No errors.

**Step 3: Commit**

```bash
git add backend/
git commit -m "feat: add git worktree management"
```

---

### Task 6: Add Repository API Endpoints

**Files:**
- Create: `backend/server/handlers.go`
- Modify: `backend/server/router.go`
- Modify: `backend/main.go`

**Step 1: Create handlers.go**

Create `backend/server/handlers.go`:
```go
package server

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/chatml/chatml-backend/git"
	"github.com/chatml/chatml-backend/models"
	"github.com/chatml/chatml-backend/store"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type Handlers struct {
	store           *store.Store
	repoManager     *git.RepoManager
	worktreeManager *git.WorktreeManager
}

func NewHandlers(s *store.Store) *Handlers {
	return &Handlers{
		store:           s,
		repoManager:     git.NewRepoManager(),
		worktreeManager: git.NewWorktreeManager(),
	}
}

type AddRepoRequest struct {
	Path string `json:"path"`
}

func (h *Handlers) AddRepo(w http.ResponseWriter, r *http.Request) {
	var req AddRepoRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if err := h.repoManager.ValidateRepo(req.Path); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	branch, _ := h.repoManager.GetCurrentBranch(req.Path)

	repo := &models.Repo{
		ID:        uuid.New().String(),
		Name:      h.repoManager.GetRepoName(req.Path),
		Path:      req.Path,
		Branch:    branch,
		CreatedAt: time.Now(),
	}

	h.store.AddRepo(repo)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(repo)
}

func (h *Handlers) ListRepos(w http.ResponseWriter, r *http.Request) {
	repos := h.store.ListRepos()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(repos)
}

func (h *Handlers) GetRepo(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	repo := h.store.GetRepo(id)
	if repo == nil {
		http.Error(w, "repo not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(repo)
}

func (h *Handlers) DeleteRepo(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	h.store.DeleteRepo(id)
	w.WriteHeader(http.StatusNoContent)
}
```

**Step 2: Install uuid package**

Run:
```bash
cd backend && go get github.com/google/uuid
```

**Step 3: Update router.go**

Modify `backend/server/router.go`:
```go
package server

import (
	"encoding/json"
	"net/http"

	"github.com/chatml/chatml-backend/store"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/rs/cors"
)

func NewRouter(s *store.Store) http.Handler {
	r := chi.NewRouter()
	h := NewHandlers(s)

	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})

	// Repository endpoints
	r.Route("/api/repos", func(r chi.Router) {
		r.Get("/", h.ListRepos)
		r.Post("/", h.AddRepo)
		r.Get("/{id}", h.GetRepo)
		r.Delete("/{id}", h.DeleteRepo)
	})

	handler := cors.New(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"*"},
		AllowCredentials: true,
	}).Handler(r)

	return handler
}
```

**Step 4: Update main.go**

Modify `backend/main.go`:
```go
package main

import (
	"log"
	"net/http"
	"os"

	"github.com/chatml/chatml-backend/server"
	"github.com/chatml/chatml-backend/store"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "9876"
	}

	s := store.New()
	router := server.NewRouter(s)

	log.Printf("ChatML backend starting on port %s", port)
	if err := http.ListenAndServe(":"+port, router); err != nil {
		log.Fatal(err)
	}
}
```

**Step 5: Test build and endpoints**

Run:
```bash
cd backend && go build -o chatml-backend && ./chatml-backend &
sleep 1
curl -X POST http://localhost:9876/api/repos -H "Content-Type: application/json" -d '{"path":"/tmp/test-repo"}'
curl http://localhost:9876/api/repos
pkill chatml-backend
```

Expected: First returns error (not a repo), second returns `[]`.

**Step 6: Commit**

```bash
git add backend/
git commit -m "feat: add repository CRUD API endpoints"
```

---

## Phase 3: Agent Core

### Task 7: Implement Agent Process Manager

**Files:**
- Create: `backend/agent/manager.go`
- Create: `backend/agent/process.go`

**Step 1: Create process.go**

Create `backend/agent/process.go`:
```go
package agent

import (
	"bufio"
	"context"
	"fmt"
	"os/exec"
	"sync"
)

type Process struct {
	ID      string
	cmd     *exec.Cmd
	cancel  context.CancelFunc
	output  chan string
	done    chan struct{}
	mu      sync.Mutex
	running bool
}

func NewProcess(id, workdir, task string) *Process {
	ctx, cancel := context.WithCancel(context.Background())

	cmd := exec.CommandContext(ctx, "claude", "-p", task, "--dangerously-skip-permissions")
	cmd.Dir = workdir

	return &Process{
		ID:     id,
		cmd:    cmd,
		cancel: cancel,
		output: make(chan string, 100),
		done:   make(chan struct{}),
	}
}

func (p *Process) Start() error {
	p.mu.Lock()
	defer p.mu.Unlock()

	stdout, err := p.cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("stdout pipe: %w", err)
	}

	stderr, err := p.cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("stderr pipe: %w", err)
	}

	if err := p.cmd.Start(); err != nil {
		return fmt.Errorf("start: %w", err)
	}

	p.running = true

	// Stream stdout
	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			select {
			case p.output <- scanner.Text():
			default:
				// Drop if buffer full
			}
		}
	}()

	// Stream stderr
	go func() {
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			select {
			case p.output <- "[stderr] " + scanner.Text():
			default:
			}
		}
	}()

	// Wait for completion
	go func() {
		p.cmd.Wait()
		p.mu.Lock()
		p.running = false
		p.mu.Unlock()
		close(p.done)
	}()

	return nil
}

func (p *Process) Stop() {
	p.cancel()
}

func (p *Process) Output() <-chan string {
	return p.output
}

func (p *Process) Done() <-chan struct{} {
	return p.done
}

func (p *Process) IsRunning() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.running
}
```

**Step 2: Create manager.go**

Create `backend/agent/manager.go`:
```go
package agent

import (
	"sync"
	"time"

	"github.com/chatml/chatml-backend/git"
	"github.com/chatml/chatml-backend/models"
	"github.com/chatml/chatml-backend/store"
	"github.com/google/uuid"
)

type OutputHandler func(agentID string, line string)
type StatusHandler func(agentID string, status models.AgentStatus)

type Manager struct {
	store           *store.Store
	worktreeManager *git.WorktreeManager
	processes       map[string]*Process
	mu              sync.RWMutex
	onOutput        OutputHandler
	onStatus        StatusHandler
}

func NewManager(s *store.Store, wm *git.WorktreeManager) *Manager {
	return &Manager{
		store:           s,
		worktreeManager: wm,
		processes:       make(map[string]*Process),
	}
}

func (m *Manager) SetOutputHandler(handler OutputHandler) {
	m.onOutput = handler
}

func (m *Manager) SetStatusHandler(handler StatusHandler) {
	m.onStatus = handler
}

func (m *Manager) SpawnAgent(repoPath, repoID, task string) (*models.Agent, error) {
	agentID := uuid.New().String()[:8]

	// Create worktree
	worktreePath, branchName, err := m.worktreeManager.Create(repoPath, agentID)
	if err != nil {
		return nil, err
	}

	agent := &models.Agent{
		ID:        agentID,
		RepoID:    repoID,
		Task:      task,
		Status:    string(models.StatusPending),
		Worktree:  worktreePath,
		Branch:    branchName,
		CreatedAt: time.Now(),
	}

	m.store.AddAgent(agent)

	// Create and start process
	proc := NewProcess(agentID, worktreePath, task)

	m.mu.Lock()
	m.processes[agentID] = proc
	m.mu.Unlock()

	if err := proc.Start(); err != nil {
		m.store.UpdateAgentStatus(agentID, models.StatusError)
		return agent, err
	}

	m.store.UpdateAgentStatus(agentID, models.StatusRunning)
	if m.onStatus != nil {
		m.onStatus(agentID, models.StatusRunning)
	}

	// Handle output streaming
	go func() {
		for line := range proc.Output() {
			if m.onOutput != nil {
				m.onOutput(agentID, line)
			}
		}
	}()

	// Handle completion
	go func() {
		<-proc.Done()
		m.store.UpdateAgentStatus(agentID, models.StatusDone)
		if m.onStatus != nil {
			m.onStatus(agentID, models.StatusDone)
		}
	}()

	return agent, nil
}

func (m *Manager) StopAgent(agentID string) {
	m.mu.RLock()
	proc, ok := m.processes[agentID]
	m.mu.RUnlock()

	if ok {
		proc.Stop()
		m.store.UpdateAgentStatus(agentID, models.StatusError)
		if m.onStatus != nil {
			m.onStatus(agentID, models.StatusError)
		}
	}
}

func (m *Manager) GetProcess(agentID string) *Process {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.processes[agentID]
}
```

**Step 3: Test build**

Run:
```bash
cd backend && go build ./...
```

Expected: No errors.

**Step 4: Commit**

```bash
git add backend/
git commit -m "feat: add agent process manager with output streaming"
```

---

### Task 8: Add WebSocket Support

**Files:**
- Create: `backend/server/websocket.go`
- Modify: `backend/server/router.go`
- Modify: `backend/server/handlers.go`

**Step 1: Create websocket.go**

Create `backend/server/websocket.go`:
```go
package server

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins for dev
	},
}

type Event struct {
	Type    string      `json:"type"`
	AgentID string      `json:"agentId,omitempty"`
	Payload interface{} `json:"payload"`
}

type Hub struct {
	clients    map[*websocket.Conn]bool
	broadcast  chan Event
	register   chan *websocket.Conn
	unregister chan *websocket.Conn
	mu         sync.RWMutex
}

func NewHub() *Hub {
	return &Hub{
		clients:    make(map[*websocket.Conn]bool),
		broadcast:  make(chan Event, 256),
		register:   make(chan *websocket.Conn),
		unregister: make(chan *websocket.Conn),
	}
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			h.mu.Unlock()
			log.Printf("Client connected, total: %d", len(h.clients))

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				client.Close()
			}
			h.mu.Unlock()
			log.Printf("Client disconnected, total: %d", len(h.clients))

		case event := <-h.broadcast:
			h.mu.RLock()
			for client := range h.clients {
				data, _ := json.Marshal(event)
				if err := client.WriteMessage(websocket.TextMessage, data); err != nil {
					log.Printf("Error sending to client: %v", err)
				}
			}
			h.mu.RUnlock()
		}
	}
}

func (h *Hub) Broadcast(event Event) {
	select {
	case h.broadcast <- event:
	default:
		log.Println("Broadcast channel full, dropping event")
	}
}

func (h *Hub) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}

	h.register <- conn

	// Keep connection alive, handle client messages if needed
	go func() {
		defer func() {
			h.unregister <- conn
		}()
		for {
			_, _, err := conn.ReadMessage()
			if err != nil {
				break
			}
		}
	}()
}
```

**Step 2: Update router.go to include WebSocket and agent routes**

Modify `backend/server/router.go`:
```go
package server

import (
	"encoding/json"
	"net/http"

	"github.com/chatml/chatml-backend/agent"
	"github.com/chatml/chatml-backend/git"
	"github.com/chatml/chatml-backend/models"
	"github.com/chatml/chatml-backend/store"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/rs/cors"
)

func NewRouter(s *store.Store, hub *Hub, agentMgr *agent.Manager) http.Handler {
	r := chi.NewRouter()
	h := NewHandlers(s, agentMgr)

	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})

	// WebSocket
	r.Get("/ws", hub.HandleWebSocket)

	// Repository endpoints
	r.Route("/api/repos", func(r chi.Router) {
		r.Get("/", h.ListRepos)
		r.Post("/", h.AddRepo)
		r.Get("/{id}", h.GetRepo)
		r.Delete("/{id}", h.DeleteRepo)
		r.Get("/{id}/agents", h.ListAgents)
		r.Post("/{id}/agents", h.SpawnAgent)
	})

	// Agent endpoints
	r.Route("/api/agents", func(r chi.Router) {
		r.Get("/{id}", h.GetAgent)
		r.Post("/{id}/stop", h.StopAgent)
		r.Get("/{id}/diff", h.GetAgentDiff)
		r.Post("/{id}/merge", h.MergeAgent)
		r.Delete("/{id}", h.DeleteAgent)
	})

	// Wire up agent manager callbacks
	agentMgr.SetOutputHandler(func(agentID, line string) {
		hub.Broadcast(Event{
			Type:    "output",
			AgentID: agentID,
			Payload: line,
		})
	})

	agentMgr.SetStatusHandler(func(agentID string, status models.AgentStatus) {
		hub.Broadcast(Event{
			Type:    "status",
			AgentID: agentID,
			Payload: string(status),
		})
	})

	handler := cors.New(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"*"},
		AllowCredentials: true,
	}).Handler(r)

	return handler
}
```

**Step 3: Update handlers.go with agent endpoints**

Modify `backend/server/handlers.go`:
```go
package server

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/chatml/chatml-backend/agent"
	"github.com/chatml/chatml-backend/git"
	"github.com/chatml/chatml-backend/models"
	"github.com/chatml/chatml-backend/store"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type Handlers struct {
	store           *store.Store
	repoManager     *git.RepoManager
	worktreeManager *git.WorktreeManager
	agentManager    *agent.Manager
}

func NewHandlers(s *store.Store, am *agent.Manager) *Handlers {
	return &Handlers{
		store:           s,
		repoManager:     git.NewRepoManager(),
		worktreeManager: git.NewWorktreeManager(),
		agentManager:    am,
	}
}

type AddRepoRequest struct {
	Path string `json:"path"`
}

func (h *Handlers) AddRepo(w http.ResponseWriter, r *http.Request) {
	var req AddRepoRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if err := h.repoManager.ValidateRepo(req.Path); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	branch, _ := h.repoManager.GetCurrentBranch(req.Path)

	repo := &models.Repo{
		ID:        uuid.New().String(),
		Name:      h.repoManager.GetRepoName(req.Path),
		Path:      req.Path,
		Branch:    branch,
		CreatedAt: time.Now(),
	}

	h.store.AddRepo(repo)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(repo)
}

func (h *Handlers) ListRepos(w http.ResponseWriter, r *http.Request) {
	repos := h.store.ListRepos()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(repos)
}

func (h *Handlers) GetRepo(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	repo := h.store.GetRepo(id)
	if repo == nil {
		http.Error(w, "repo not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(repo)
}

func (h *Handlers) DeleteRepo(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	h.store.DeleteRepo(id)
	w.WriteHeader(http.StatusNoContent)
}

type SpawnAgentRequest struct {
	Task string `json:"task"`
}

func (h *Handlers) SpawnAgent(w http.ResponseWriter, r *http.Request) {
	repoID := chi.URLParam(r, "id")
	repo := h.store.GetRepo(repoID)
	if repo == nil {
		http.Error(w, "repo not found", http.StatusNotFound)
		return
	}

	var req SpawnAgentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	agent, err := h.agentManager.SpawnAgent(repo.Path, repoID, req.Task)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(agent)
}

func (h *Handlers) ListAgents(w http.ResponseWriter, r *http.Request) {
	repoID := chi.URLParam(r, "id")
	agents := h.store.ListAgents(repoID)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(agents)
}

func (h *Handlers) GetAgent(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	agent := h.store.GetAgent(id)
	if agent == nil {
		http.Error(w, "agent not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(agent)
}

func (h *Handlers) StopAgent(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	h.agentManager.StopAgent(id)
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handlers) GetAgentDiff(w http.ResponseWriter, r *http.Request) {
	agentID := chi.URLParam(r, "id")
	agent := h.store.GetAgent(agentID)
	if agent == nil {
		http.Error(w, "agent not found", http.StatusNotFound)
		return
	}

	repo := h.store.GetRepo(agent.RepoID)
	if repo == nil {
		http.Error(w, "repo not found", http.StatusNotFound)
		return
	}

	diff, err := h.worktreeManager.GetDiff(repo.Path, agentID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/plain")
	w.Write([]byte(diff))
}

func (h *Handlers) MergeAgent(w http.ResponseWriter, r *http.Request) {
	agentID := chi.URLParam(r, "id")
	agent := h.store.GetAgent(agentID)
	if agent == nil {
		http.Error(w, "agent not found", http.StatusNotFound)
		return
	}

	repo := h.store.GetRepo(agent.RepoID)
	if repo == nil {
		http.Error(w, "repo not found", http.StatusNotFound)
		return
	}

	if err := h.worktreeManager.Merge(repo.Path, agentID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *Handlers) DeleteAgent(w http.ResponseWriter, r *http.Request) {
	agentID := chi.URLParam(r, "id")
	agent := h.store.GetAgent(agentID)
	if agent == nil {
		http.Error(w, "agent not found", http.StatusNotFound)
		return
	}

	repo := h.store.GetRepo(agent.RepoID)
	if repo != nil {
		h.worktreeManager.Remove(repo.Path, agentID)
	}

	w.WriteHeader(http.StatusNoContent)
}
```

**Step 4: Update main.go**

Modify `backend/main.go`:
```go
package main

import (
	"log"
	"net/http"
	"os"

	"github.com/chatml/chatml-backend/agent"
	"github.com/chatml/chatml-backend/git"
	"github.com/chatml/chatml-backend/server"
	"github.com/chatml/chatml-backend/store"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "9876"
	}

	s := store.New()
	hub := server.NewHub()
	wm := git.NewWorktreeManager()
	agentMgr := agent.NewManager(s, wm)

	go hub.Run()

	router := server.NewRouter(s, hub, agentMgr)

	log.Printf("ChatML backend starting on port %s", port)
	if err := http.ListenAndServe(":"+port, router); err != nil {
		log.Fatal(err)
	}
}
```

**Step 5: Test build**

Run:
```bash
cd backend && go build -o chatml-backend
```

Expected: No errors.

**Step 6: Commit**

```bash
git add backend/
git commit -m "feat: add WebSocket support and agent API endpoints"
```

---

## Phase 4: Frontend Implementation

### Task 9: Set Up Frontend State and API

**Files:**
- Create: `src/lib/types.ts`
- Create: `src/lib/api.ts`
- Create: `src/stores/appStore.ts`
- Create: `src/hooks/useWebSocket.ts`

**Step 1: Install dependencies**

Run:
```bash
npm install zustand
```

**Step 2: Create types.ts**

Create `src/lib/types.ts`:
```typescript
export interface Repo {
  id: string;
  name: string;
  path: string;
  branch: string;
  createdAt: string;
}

export interface Agent {
  id: string;
  repoId: string;
  task: string;
  status: 'pending' | 'running' | 'done' | 'error';
  worktree: string;
  branch: string;
  createdAt: string;
}

export interface WSEvent {
  type: 'output' | 'status';
  agentId: string;
  payload: string;
}
```

**Step 3: Create api.ts**

Create `src/lib/api.ts`:
```typescript
const API_BASE = 'http://localhost:9876';

export async function listRepos() {
  const res = await fetch(`${API_BASE}/api/repos`);
  return res.json();
}

export async function addRepo(path: string) {
  const res = await fetch(`${API_BASE}/api/repos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteRepo(id: string) {
  await fetch(`${API_BASE}/api/repos/${id}`, { method: 'DELETE' });
}

export async function listAgents(repoId: string) {
  const res = await fetch(`${API_BASE}/api/repos/${repoId}/agents`);
  return res.json();
}

export async function spawnAgent(repoId: string, task: string) {
  const res = await fetch(`${API_BASE}/api/repos/${repoId}/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function stopAgent(agentId: string) {
  await fetch(`${API_BASE}/api/agents/${agentId}/stop`, { method: 'POST' });
}

export async function getAgentDiff(agentId: string) {
  const res = await fetch(`${API_BASE}/api/agents/${agentId}/diff`);
  return res.text();
}

export async function mergeAgent(agentId: string) {
  await fetch(`${API_BASE}/api/agents/${agentId}/merge`, { method: 'POST' });
}

export async function deleteAgent(agentId: string) {
  await fetch(`${API_BASE}/api/agents/${agentId}`, { method: 'DELETE' });
}
```

**Step 4: Create appStore.ts**

Create `src/stores/appStore.ts`:
```typescript
import { create } from 'zustand';
import type { Repo, Agent } from '@/lib/types';

interface AgentOutput {
  [agentId: string]: string[];
}

interface AppState {
  repos: Repo[];
  selectedRepoId: string | null;
  agents: Agent[];
  agentOutputs: AgentOutput;

  setRepos: (repos: Repo[]) => void;
  addRepo: (repo: Repo) => void;
  removeRepo: (id: string) => void;
  selectRepo: (id: string | null) => void;

  setAgents: (agents: Agent[]) => void;
  addAgent: (agent: Agent) => void;
  updateAgentStatus: (agentId: string, status: Agent['status']) => void;

  appendOutput: (agentId: string, line: string) => void;
  clearOutput: (agentId: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  repos: [],
  selectedRepoId: null,
  agents: [],
  agentOutputs: {},

  setRepos: (repos) => set({ repos }),
  addRepo: (repo) => set((state) => ({ repos: [...state.repos, repo] })),
  removeRepo: (id) => set((state) => ({
    repos: state.repos.filter((r) => r.id !== id),
    selectedRepoId: state.selectedRepoId === id ? null : state.selectedRepoId,
  })),
  selectRepo: (id) => set({ selectedRepoId: id }),

  setAgents: (agents) => set({ agents }),
  addAgent: (agent) => set((state) => ({ agents: [...state.agents, agent] })),
  updateAgentStatus: (agentId, status) => set((state) => ({
    agents: state.agents.map((a) =>
      a.id === agentId ? { ...a, status } : a
    ),
  })),

  appendOutput: (agentId, line) => set((state) => ({
    agentOutputs: {
      ...state.agentOutputs,
      [agentId]: [...(state.agentOutputs[agentId] || []), line],
    },
  })),
  clearOutput: (agentId) => set((state) => ({
    agentOutputs: {
      ...state.agentOutputs,
      [agentId]: [],
    },
  })),
}));
```

**Step 5: Create useWebSocket.ts**

Create `src/hooks/useWebSocket.ts`:
```typescript
import { useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '@/stores/appStore';
import type { WSEvent, Agent } from '@/lib/types';

const WS_URL = 'ws://localhost:9876/ws';

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const { appendOutput, updateAgentStatus } = useAppStore();

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log('WebSocket connected');
    };

    ws.onmessage = (event) => {
      try {
        const data: WSEvent = JSON.parse(event.data);

        if (data.type === 'output') {
          appendOutput(data.agentId, data.payload);
        } else if (data.type === 'status') {
          updateAgentStatus(data.agentId, data.payload as Agent['status']);
        }
      } catch (e) {
        console.error('Failed to parse WebSocket message:', e);
      }
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected, reconnecting...');
      setTimeout(connect, 2000);
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      ws.close();
    };

    wsRef.current = ws;
  }, [appendOutput, updateAgentStatus]);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
    };
  }, [connect]);

  return wsRef.current;
}
```

**Step 6: Test build**

Run:
```bash
npm run build
```

Expected: Build succeeds (may have warnings about unused code).

**Step 7: Commit**

```bash
git add src/
git commit -m "feat: add frontend state management and API client"
```

---

### Task 10: Build Main UI Components

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/app/layout.tsx`
- Create: `src/components/RepoList.tsx`
- Create: `src/components/AddRepoModal.tsx`
- Create: `src/components/AgentCard.tsx`
- Create: `src/components/AgentSpawnForm.tsx`
- Create: `src/components/OutputLog.tsx`

**Step 1: Update layout.tsx**

Modify `src/app/layout.tsx`:
```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ChatML",
  description: "AI Agent Orchestration",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-900 text-gray-100">{children}</body>
    </html>
  );
}
```

**Step 2: Create RepoList.tsx**

Create `src/components/RepoList.tsx`:
```tsx
'use client';

import { useAppStore } from '@/stores/appStore';
import { deleteRepo } from '@/lib/api';

interface RepoListProps {
  onAddClick: () => void;
}

export function RepoList({ onAddClick }: RepoListProps) {
  const { repos, selectedRepoId, selectRepo, removeRepo } = useAppStore();

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteRepo(id);
    removeRepo(id);
  };

  return (
    <div className="w-64 bg-gray-800 border-r border-gray-700 flex flex-col">
      <div className="p-4 border-b border-gray-700">
        <h1 className="text-xl font-bold">ChatML</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {repos.map((repo) => (
          <div
            key={repo.id}
            onClick={() => selectRepo(repo.id)}
            className={`p-3 rounded cursor-pointer flex justify-between items-center ${
              selectedRepoId === repo.id
                ? 'bg-blue-600'
                : 'hover:bg-gray-700'
            }`}
          >
            <div>
              <div className="font-medium">{repo.name}</div>
              <div className="text-xs text-gray-400">{repo.branch}</div>
            </div>
            <button
              onClick={(e) => handleDelete(repo.id, e)}
              className="text-gray-400 hover:text-red-400"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="p-2 border-t border-gray-700">
        <button
          onClick={onAddClick}
          className="w-full p-2 bg-blue-600 hover:bg-blue-700 rounded"
        >
          + Add Repository
        </button>
      </div>
    </div>
  );
}
```

**Step 3: Create AddRepoModal.tsx**

Create `src/components/AddRepoModal.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { addRepo } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';

interface AddRepoModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AddRepoModal({ isOpen, onClose }: AddRepoModalProps) {
  const [path, setPath] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { addRepo: addRepoToStore } = useAppStore();

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const repo = await addRepo(path);
      addRepoToStore(repo);
      setPath('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add repository');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-6 w-96">
        <h2 className="text-xl font-bold mb-4">Add Repository</h2>

        <form onSubmit={handleSubmit}>
          <input
            type="text"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="/path/to/repository"
            className="w-full p-2 bg-gray-700 rounded border border-gray-600 mb-4"
            autoFocus
          />

          {error && (
            <div className="text-red-400 text-sm mb-4">{error}</div>
          )}

          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-gray-600 hover:bg-gray-700 rounded"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !path}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded disabled:opacity-50"
            >
              {loading ? 'Adding...' : 'Add'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

**Step 4: Create OutputLog.tsx**

Create `src/components/OutputLog.tsx`:
```tsx
'use client';

import { useEffect, useRef } from 'react';
import { useAppStore } from '@/stores/appStore';

interface OutputLogProps {
  agentId: string;
}

export function OutputLog({ agentId }: OutputLogProps) {
  const output = useAppStore((state) => state.agentOutputs[agentId] || []);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [output]);

  return (
    <div
      ref={containerRef}
      className="bg-gray-900 rounded p-3 h-48 overflow-y-auto font-mono text-sm"
    >
      {output.length === 0 ? (
        <span className="text-gray-500">Waiting for output...</span>
      ) : (
        output.map((line, i) => (
          <div key={i} className="text-gray-300">
            {line}
          </div>
        ))
      )}
    </div>
  );
}
```

**Step 5: Create AgentCard.tsx**

Create `src/components/AgentCard.tsx`:
```tsx
'use client';

import type { Agent } from '@/lib/types';
import { stopAgent, getAgentDiff, mergeAgent, deleteAgent } from '@/lib/api';
import { OutputLog } from './OutputLog';
import { useState } from 'react';

interface AgentCardProps {
  agent: Agent;
  onRefresh: () => void;
}

const statusColors = {
  pending: 'bg-yellow-500',
  running: 'bg-blue-500',
  done: 'bg-green-500',
  error: 'bg-red-500',
};

export function AgentCard({ agent, onRefresh }: AgentCardProps) {
  const [showDiff, setShowDiff] = useState(false);
  const [diff, setDiff] = useState('');

  const handleStop = async () => {
    await stopAgent(agent.id);
    onRefresh();
  };

  const handleViewDiff = async () => {
    const d = await getAgentDiff(agent.id);
    setDiff(d);
    setShowDiff(true);
  };

  const handleMerge = async () => {
    await mergeAgent(agent.id);
    await deleteAgent(agent.id);
    onRefresh();
  };

  const handleDiscard = async () => {
    await deleteAgent(agent.id);
    onRefresh();
  };

  return (
    <div className="bg-gray-800 rounded-lg p-4 mb-4">
      <div className="flex justify-between items-start mb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${statusColors[agent.status]}`} />
            <span className="font-medium">Agent {agent.id.slice(0, 8)}</span>
            <span className="text-gray-400 text-sm">{agent.status}</span>
          </div>
          <div className="text-sm text-gray-400 mt-1">{agent.task}</div>
        </div>

        <div className="flex gap-2">
          {agent.status === 'running' && (
            <button
              onClick={handleStop}
              className="px-3 py-1 bg-red-600 hover:bg-red-700 rounded text-sm"
            >
              Stop
            </button>
          )}
          {agent.status === 'done' && (
            <>
              <button
                onClick={handleViewDiff}
                className="px-3 py-1 bg-gray-600 hover:bg-gray-700 rounded text-sm"
              >
                View Diff
              </button>
              <button
                onClick={handleMerge}
                className="px-3 py-1 bg-green-600 hover:bg-green-700 rounded text-sm"
              >
                Merge
              </button>
              <button
                onClick={handleDiscard}
                className="px-3 py-1 bg-gray-600 hover:bg-gray-700 rounded text-sm"
              >
                Discard
              </button>
            </>
          )}
        </div>
      </div>

      <OutputLog agentId={agent.id} />

      {showDiff && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 w-3/4 max-h-3/4 overflow-auto">
            <div className="flex justify-between mb-4">
              <h3 className="text-lg font-bold">Diff</h3>
              <button onClick={() => setShowDiff(false)}>×</button>
            </div>
            <pre className="bg-gray-900 p-4 rounded overflow-x-auto text-sm">
              {diff || 'No changes'}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
```

**Step 6: Create AgentSpawnForm.tsx**

Create `src/components/AgentSpawnForm.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { spawnAgent } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';

interface AgentSpawnFormProps {
  repoId: string;
  onSpawn: () => void;
}

export function AgentSpawnForm({ repoId, onSpawn }: AgentSpawnFormProps) {
  const [task, setTask] = useState('');
  const [loading, setLoading] = useState(false);
  const addAgent = useAppStore((state) => state.addAgent);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!task.trim()) return;

    setLoading(true);
    try {
      const agent = await spawnAgent(repoId, task);
      addAgent(agent);
      setTask('');
      onSpawn();
    } catch (err) {
      console.error('Failed to spawn agent:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 mb-4">
      <input
        type="text"
        value={task}
        onChange={(e) => setTask(e.target.value)}
        placeholder="Describe the task for the agent..."
        className="flex-1 p-2 bg-gray-700 rounded border border-gray-600"
      />
      <button
        type="submit"
        disabled={loading || !task.trim()}
        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded disabled:opacity-50"
      >
        {loading ? 'Spawning...' : 'Spawn Agent'}
      </button>
    </form>
  );
}
```

**Step 7: Update page.tsx**

Modify `src/app/page.tsx`:
```tsx
'use client';

import { useEffect, useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useWebSocket } from '@/hooks/useWebSocket';
import { listRepos, listAgents } from '@/lib/api';
import { RepoList } from '@/components/RepoList';
import { AddRepoModal } from '@/components/AddRepoModal';
import { AgentCard } from '@/components/AgentCard';
import { AgentSpawnForm } from '@/components/AgentSpawnForm';

export default function Home() {
  const [showAddRepo, setShowAddRepo] = useState(false);
  const { repos, selectedRepoId, agents, setRepos, setAgents } = useAppStore();

  useWebSocket();

  useEffect(() => {
    listRepos().then(setRepos);
  }, [setRepos]);

  useEffect(() => {
    if (selectedRepoId) {
      listAgents(selectedRepoId).then(setAgents);
    }
  }, [selectedRepoId, setAgents]);

  const selectedRepo = repos.find((r) => r.id === selectedRepoId);
  const repoAgents = agents.filter((a) => a.repoId === selectedRepoId);

  const refreshAgents = () => {
    if (selectedRepoId) {
      listAgents(selectedRepoId).then(setAgents);
    }
  };

  return (
    <div className="flex h-screen">
      <RepoList onAddClick={() => setShowAddRepo(true)} />

      <div className="flex-1 p-6 overflow-y-auto">
        {selectedRepo ? (
          <>
            <div className="mb-6">
              <h2 className="text-2xl font-bold">{selectedRepo.name}</h2>
              <div className="text-gray-400">{selectedRepo.path}</div>
            </div>

            <AgentSpawnForm repoId={selectedRepoId!} onSpawn={refreshAgents} />

            {repoAgents.length === 0 ? (
              <div className="text-gray-500 text-center py-12">
                No agents running. Spawn one above!
              </div>
            ) : (
              repoAgents.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  onRefresh={refreshAgents}
                />
              ))
            )}
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500">
            Select a repository to get started
          </div>
        )}
      </div>

      <AddRepoModal
        isOpen={showAddRepo}
        onClose={() => setShowAddRepo(false)}
      />
    </div>
  );
}
```

**Step 8: Test frontend build**

Run:
```bash
npm run build
```

Expected: Build succeeds.

**Step 9: Commit**

```bash
git add src/
git commit -m "feat: add main UI components for repo and agent management"
```

---

## Phase 5: Integration & Polish

### Task 11: End-to-End Test

**Step 1: Build backend**

Run:
```bash
make backend
```

**Step 2: Run dev mode**

Run:
```bash
make dev
```

**Step 3: Manual test checklist**

- [ ] App launches with Tauri window
- [ ] Add a git repository (use any repo on your machine)
- [ ] Repository appears in sidebar
- [ ] Select repository
- [ ] Spawn agent with a simple task like "Create a README file"
- [ ] See agent output streaming in real-time
- [ ] Agent status changes to "done" on completion
- [ ] View diff shows changes
- [ ] Merge or discard works

**Step 4: Fix any issues found**

Debug and fix as needed based on test results.

**Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: integration fixes from end-to-end testing"
```

---

### Task 12: Add Basic Error Handling

**Files:**
- Modify: `backend/agent/process.go`
- Modify: `src/components/AgentCard.tsx`

**Step 1: Improve process error handling**

In `backend/agent/process.go`, update the wait goroutine:
```go
// Wait for completion
go func() {
    err := p.cmd.Wait()
    p.mu.Lock()
    p.running = false
    p.exitErr = err
    p.mu.Unlock()
    close(p.done)
}()
```

Add `exitErr error` field to the Process struct.

**Step 2: Add error state UI**

Update `AgentCard.tsx` to show error details when status is "error".

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: improve error handling"
```

---

### Task 13: Build for Distribution

**Step 1: Build production binary**

Run:
```bash
make build
```

Expected: `.dmg` file created in `src-tauri/target/release/bundle/dmg/`.

**Step 2: Test the built app**

Open the `.dmg` and run the app outside dev mode.

**Step 3: Commit any final tweaks**

```bash
git add -A
git commit -m "chore: finalize for distribution"
```

---

## Summary

After completing all tasks, you will have:

1. **Tauri + Next.js + Go** project structure
2. **Go backend** with:
   - Repository management API
   - Git worktree operations
   - Agent process manager
   - WebSocket for real-time updates
3. **Next.js frontend** with:
   - Repository list and management
   - Agent spawning and monitoring
   - Real-time output streaming
   - Diff viewing and merge controls
4. **Production build** as a macOS `.dmg`

The MVP allows users to add repos, spawn Claude agents in isolated worktrees, monitor their progress, and merge results.
