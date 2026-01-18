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
		if m.onStatus != nil {
			m.onStatus(agentID, models.StatusError)
		}
		return agent, err
	}

	m.store.UpdateAgentStatus(agentID, models.StatusRunning)
	if m.onStatus != nil {
		m.onStatus(agentID, models.StatusRunning)
	}

	// Handle output streaming with parsing
	go func() {
		for line := range proc.Output() {
			if m.onOutput != nil {
				event := ParseStreamLine(line)
				formatted := FormatEvent(event)
				if formatted != "" {
					m.onOutput(agentID, formatted)
				}
			}
		}
	}()

	// Handle completion
	go func() {
		<-proc.Done()
		if proc.ExitError() != nil {
			m.store.UpdateAgentStatus(agentID, models.StatusError)
			if m.onStatus != nil {
				m.onStatus(agentID, models.StatusError)
			}
		} else {
			m.store.UpdateAgentStatus(agentID, models.StatusDone)
			if m.onStatus != nil {
				m.onStatus(agentID, models.StatusDone)
			}
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
