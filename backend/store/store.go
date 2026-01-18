package store

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"sync"

	"github.com/chatml/chatml-backend/models"
)

type Store struct {
	mu       sync.RWMutex
	repos    map[string]*models.Repo
	sessions map[string]*models.Session
	agents   map[string]*models.Agent
	dataPath string
}

// persistedData represents the data structure saved to disk
type persistedData struct {
	Repos    []*models.Repo    `json:"repos"`
	Sessions []*models.Session `json:"sessions"`
	Agents   []*models.Agent   `json:"agents"`
}

func New() *Store {
	s := &Store{
		repos:    make(map[string]*models.Repo),
		sessions: make(map[string]*models.Session),
		agents:   make(map[string]*models.Agent),
	}

	// Set up data path in user's home directory
	homeDir, err := os.UserHomeDir()
	if err == nil {
		dataDir := filepath.Join(homeDir, ".chatml")
		if err := os.MkdirAll(dataDir, 0755); err != nil {
			log.Printf("[store] Failed to create data dir: %v", err)
		}
		s.dataPath = filepath.Join(dataDir, "data.json")
		log.Printf("[store] Data path: %s", s.dataPath)

		// Load existing data
		if err := s.load(); err != nil {
			log.Printf("[store] Failed to load data: %v", err)
		}
	} else {
		log.Printf("[store] Failed to get home dir: %v", err)
	}

	return s
}

// load reads persisted data from disk
func (s *Store) load() error {
	data, err := os.ReadFile(s.dataPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil // No data file yet, that's OK
		}
		return err
	}

	var persisted persistedData
	if err := json.Unmarshal(data, &persisted); err != nil {
		return err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	for _, repo := range persisted.Repos {
		s.repos[repo.ID] = repo
	}
	for _, session := range persisted.Sessions {
		s.sessions[session.ID] = session
	}
	for _, agent := range persisted.Agents {
		s.agents[agent.ID] = agent
	}

	return nil
}

// save writes current data to disk
func (s *Store) save() error {
	if s.dataPath == "" {
		return nil
	}

	s.mu.RLock()
	persisted := persistedData{
		Repos:    make([]*models.Repo, 0, len(s.repos)),
		Sessions: make([]*models.Session, 0, len(s.sessions)),
		Agents:   make([]*models.Agent, 0, len(s.agents)),
	}
	for _, repo := range s.repos {
		persisted.Repos = append(persisted.Repos, repo)
	}
	for _, session := range s.sessions {
		persisted.Sessions = append(persisted.Sessions, session)
	}
	for _, agent := range s.agents {
		persisted.Agents = append(persisted.Agents, agent)
	}
	s.mu.RUnlock()

	data, err := json.MarshalIndent(persisted, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(s.dataPath, data, 0644)
}

func (s *Store) AddRepo(repo *models.Repo) {
	s.mu.Lock()
	s.repos[repo.ID] = repo
	s.mu.Unlock()
	if err := s.save(); err != nil {
		log.Printf("[store] Failed to save after AddRepo: %v", err)
	} else {
		log.Printf("[store] Saved %d repos to %s", len(s.repos), s.dataPath)
	}
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
	delete(s.repos, id)
	s.mu.Unlock()
	s.save()
}

// Session methods

func (s *Store) AddSession(session *models.Session) {
	s.mu.Lock()
	s.sessions[session.ID] = session
	s.mu.Unlock()
	if err := s.save(); err != nil {
		log.Printf("[store] Failed to save after AddSession: %v", err)
	}
}

func (s *Store) GetSession(id string) *models.Session {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.sessions[id]
}

func (s *Store) ListSessions(workspaceID string) []*models.Session {
	s.mu.RLock()
	defer s.mu.RUnlock()
	sessions := make([]*models.Session, 0)
	for _, session := range s.sessions {
		if session.WorkspaceID == workspaceID {
			sessions = append(sessions, session)
		}
	}
	return sessions
}

func (s *Store) UpdateSession(id string, updates func(*models.Session)) {
	s.mu.Lock()
	if session, ok := s.sessions[id]; ok {
		updates(session)
	}
	s.mu.Unlock()
	if err := s.save(); err != nil {
		log.Printf("[store] Failed to save after UpdateSession: %v", err)
	}
}

func (s *Store) DeleteSession(id string) {
	s.mu.Lock()
	delete(s.sessions, id)
	s.mu.Unlock()
	if err := s.save(); err != nil {
		log.Printf("[store] Failed to save after DeleteSession: %v", err)
	}
}

// Agent methods

func (s *Store) AddAgent(agent *models.Agent) {
	s.mu.Lock()
	s.agents[agent.ID] = agent
	s.mu.Unlock()
	s.save()
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
	if agent, ok := s.agents[id]; ok {
		agent.Status = string(status)
	}
	s.mu.Unlock()
	s.save()
}

func (s *Store) DeleteAgent(id string) {
	s.mu.Lock()
	delete(s.agents, id)
	s.mu.Unlock()
	s.save()
}
