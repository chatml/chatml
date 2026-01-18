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

func (s *Store) DeleteAgent(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.agents, id)
}
