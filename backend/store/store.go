package store

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"

	"github.com/chatml/chatml-backend/logger"
	"github.com/chatml/chatml-backend/models"
)

type Store struct {
	mu            sync.RWMutex
	repos         map[string]*models.Repo
	sessions      map[string]*models.Session
	agents        map[string]*models.Agent
	conversations map[string]*models.Conversation
	dataPath      string
}

// persistedData represents the data structure saved to disk
type persistedData struct {
	Repos         []*models.Repo         `json:"repos"`
	Sessions      []*models.Session      `json:"sessions"`
	Agents        []*models.Agent        `json:"agents"`
	Conversations []*models.Conversation `json:"conversations"`
}

func New() *Store {
	s := &Store{
		repos:         make(map[string]*models.Repo),
		sessions:      make(map[string]*models.Session),
		agents:        make(map[string]*models.Agent),
		conversations: make(map[string]*models.Conversation),
	}

	// Set up data path in user's home directory
	homeDir, err := os.UserHomeDir()
	if err == nil {
		dataDir := filepath.Join(homeDir, ".chatml")
		if err := os.MkdirAll(dataDir, 0755); err != nil {
			logger.Store.Errorf("Failed to create data dir: %v", err)
		}
		s.dataPath = filepath.Join(dataDir, "data.json")
		logger.Store.Infof("Data path: %s", s.dataPath)

		// Load existing data
		if err := s.load(); err != nil {
			logger.Store.Errorf("Failed to load data: %v", err)
		}
	} else {
		logger.Store.Errorf("Failed to get home dir: %v", err)
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
	for _, conv := range persisted.Conversations {
		s.conversations[conv.ID] = conv
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
		Repos:         make([]*models.Repo, 0, len(s.repos)),
		Sessions:      make([]*models.Session, 0, len(s.sessions)),
		Agents:        make([]*models.Agent, 0, len(s.agents)),
		Conversations: make([]*models.Conversation, 0, len(s.conversations)),
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
	for _, conv := range s.conversations {
		persisted.Conversations = append(persisted.Conversations, conv)
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
		logger.Store.Errorf("Failed to save after AddRepo: %v", err)
	} else {
		logger.Store.Infof("Saved %d repos to %s", len(s.repos), s.dataPath)
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

func (s *Store) GetRepoByPath(path string) *models.Repo {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, r := range s.repos {
		if r.Path == path {
			return r
		}
	}
	return nil
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
		logger.Store.Errorf("Failed to save after AddSession: %v", err)
	}
}

func (s *Store) GetSession(id string) *models.Session {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.sessions[id]
}

func (s *Store) ListSessions(workspaceID string, includeArchived bool) []*models.Session {
	s.mu.RLock()
	defer s.mu.RUnlock()
	sessions := make([]*models.Session, 0)
	for _, session := range s.sessions {
		if session.WorkspaceID == workspaceID {
			if includeArchived || !session.Archived {
				sessions = append(sessions, session)
			}
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
		logger.Store.Errorf("Failed to save after UpdateSession: %v", err)
	}
}

func (s *Store) DeleteSession(id string) {
	s.mu.Lock()
	delete(s.sessions, id)
	s.mu.Unlock()
	if err := s.save(); err != nil {
		logger.Store.Errorf("Failed to save after DeleteSession: %v", err)
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

// Conversation methods

func (s *Store) AddConversation(conv *models.Conversation) {
	s.mu.Lock()
	s.conversations[conv.ID] = conv
	s.mu.Unlock()
	if err := s.save(); err != nil {
		logger.Store.Errorf("Failed to save after AddConversation: %v", err)
	}
}

func (s *Store) GetConversation(id string) *models.Conversation {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.conversations[id]
}

func (s *Store) ListConversations(sessionID string) []*models.Conversation {
	s.mu.RLock()
	defer s.mu.RUnlock()
	convs := make([]*models.Conversation, 0)
	for _, conv := range s.conversations {
		if conv.SessionID == sessionID {
			convs = append(convs, conv)
		}
	}
	return convs
}

func (s *Store) UpdateConversation(id string, updates func(*models.Conversation)) {
	s.mu.Lock()
	if conv, ok := s.conversations[id]; ok {
		updates(conv)
	}
	s.mu.Unlock()
	if err := s.save(); err != nil {
		logger.Store.Errorf("Failed to save after UpdateConversation: %v", err)
	}
}

func (s *Store) DeleteConversation(id string) {
	s.mu.Lock()
	delete(s.conversations, id)
	s.mu.Unlock()
	if err := s.save(); err != nil {
		logger.Store.Errorf("Failed to save after DeleteConversation: %v", err)
	}
}

func (s *Store) AddMessageToConversation(convID string, msg models.Message) {
	s.mu.Lock()
	if conv, ok := s.conversations[convID]; ok {
		conv.Messages = append(conv.Messages, msg)
	}
	s.mu.Unlock()
	if err := s.save(); err != nil {
		logger.Store.Errorf("Failed to save after AddMessageToConversation: %v", err)
	}
}

func (s *Store) AddToolActionToConversation(convID string, action models.ToolAction) {
	s.mu.Lock()
	if conv, ok := s.conversations[convID]; ok {
		conv.ToolSummary = append(conv.ToolSummary, action)
	}
	s.mu.Unlock()
	if err := s.save(); err != nil {
		logger.Store.Errorf("Failed to save after AddToolActionToConversation: %v", err)
	}
}
