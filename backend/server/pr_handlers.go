package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/chatml/chatml-backend/github"
	"github.com/chatml/chatml-backend/logger"
	"github.com/chatml/chatml-backend/models"
	"github.com/go-chi/chi/v5"
)

// GetSessionPRStatus returns PR details including CI check status for a session
func (h *Handlers) GetSessionPRStatus(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")

	// Get session
	session, err := h.store.GetSession(ctx, sessionID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if session == nil {
		writeNotFound(w, "session")
		return
	}

	// Check if session has a PR
	if session.PRNumber == 0 {
		writeNotFound(w, "no PR for this session")
		return
	}

	// Get the workspace to find the repo details
	repo, err := h.store.GetRepo(ctx, session.WorkspaceID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if repo == nil {
		writeNotFound(w, "workspace")
		return
	}

	// Extract owner/repo from git remote
	owner, repoName, err := h.repoManager.GetGitHubRemote(ctx, repo.Path)
	if err != nil {
		writeInternalError(w, "failed to get GitHub remote", err)
		return
	}

	// Check if GitHub client is available and authenticated
	if h.ghClient == nil {
		writeInternalError(w, "GitHub client not configured", nil)
		return
	}
	if !h.ghClient.IsAuthenticated() {
		writeUnauthorized(w, "GitHub authentication required to fetch PR details")
		return
	}

	// Get PR details from GitHub
	prDetails, err := h.ghClient.GetPRDetails(ctx, owner, repoName, session.PRNumber)
	if err != nil {
		writeInternalError(w, "failed to get PR details", err)
		return
	}
	if prDetails == nil {
		writeNotFound(w, "PR")
		return
	}

	writeJSON(w, prDetails)
}

// RefreshPRStatus triggers an immediate PR status check for a session
func (h *Handlers) RefreshPRStatus(w http.ResponseWriter, r *http.Request) {
	sessionID := chi.URLParam(r, "sessionId")

	if h.prWatcher == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}

	h.prWatcher.ForceCheckSession(sessionID)
	w.WriteHeader(http.StatusAccepted)
}

// ReportPRCreated is called by the MCP tool when an agent creates a PR.
// This provides a guaranteed notification path independent of bash output regex parsing.
func (h *Handlers) ReportPRCreated(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")

	var req struct {
		PRNumber int    `json:"prNumber"`
		PRURL    string `json:"prUrl"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}
	if req.PRNumber <= 0 {
		writeValidationError(w, "prNumber must be positive")
		return
	}

	if h.prWatcher == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}

	// Verify session exists
	session, err := h.store.GetSession(ctx, sessionID)
	if err != nil || session == nil {
		writeNotFound(w, "session")
		return
	}

	// RegisterPRFromAgent handles auto-registration in the watch map (via
	// ensureSessionWatched), DB update, and WebSocket broadcast in one call.
	// Don't call WatchSession separately — it would set the PR number first,
	// causing RegisterPRFromAgent to skip the DB update and broadcast.
	h.prWatcher.RegisterPRFromAgent(sessionID, req.PRNumber, req.PRURL)

	w.WriteHeader(http.StatusAccepted)
}

// UnlinkPR clears all PR data from a session. Used when the user manually
// unlinks a PR via the UI or the agent calls the clear_pr_link MCP tool.
func (h *Handlers) UnlinkPR(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessionID := chi.URLParam(r, "sessionId")

	if h.prWatcher == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}

	// Verify session exists (consistent with ReportPRCreated)
	session, err := h.store.GetSession(ctx, sessionID)
	if err != nil || session == nil {
		writeNotFound(w, "session")
		return
	}

	h.prWatcher.UnlinkPR(sessionID)
	w.WriteHeader(http.StatusAccepted)
}

// ReportPRMerged is called by the MCP tool when an agent merges a PR.
// Triggers a force-check to verify the merge against GitHub.
func (h *Handlers) ReportPRMerged(w http.ResponseWriter, r *http.Request) {
	sessionID := chi.URLParam(r, "sessionId")

	if h.prWatcher == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}

	// Read optional prNumber from body for logging (best-effort)
	var req struct {
		PRNumber int `json:"prNumber"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)

	if req.PRNumber > 0 {
		logger.Handlers.Infof("ReportPRMerged: session %s, PR #%d", sessionID, req.PRNumber)
	}

	h.prWatcher.ForceCheckSession(sessionID)
	w.WriteHeader(http.StatusAccepted)
}

// GetPRTemplate returns the custom PR template for a workspace
func (h *Handlers) GetPRTemplate(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	workspaceID := chi.URLParam(r, "id")

	key := fmt.Sprintf("pr-template:%s", workspaceID)
	value, found, err := h.store.GetSetting(ctx, key)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if !found {
		value = ""
	}

	writeJSON(w, map[string]string{"template": value})
}

// SetPRTemplate updates the custom PR template for a workspace
func (h *Handlers) SetPRTemplate(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	workspaceID := chi.URLParam(r, "id")

	var req struct {
		Template string `json:"template"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	key := fmt.Sprintf("pr-template:%s", workspaceID)
	trimmed := strings.TrimSpace(req.Template)
	if trimmed == "" {
		if err := h.store.DeleteSetting(ctx, key); err != nil {
			writeDBError(w, err)
			return
		}
	} else {
		if err := h.store.SetSetting(ctx, key, trimmed); err != nil {
			writeDBError(w, err)
			return
		}
	}

	writeJSON(w, map[string]string{"status": "ok"})
}

// GetGlobalPRTemplate returns the global custom PR template
func (h *Handlers) GetGlobalPRTemplate(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	value, found, err := h.store.GetSetting(ctx, "pr-template")
	if err != nil {
		writeDBError(w, err)
		return
	}
	if !found {
		value = ""
	}

	writeJSON(w, map[string]string{"template": value})
}

// SetGlobalPRTemplate updates the global custom PR template
func (h *Handlers) SetGlobalPRTemplate(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var req struct {
		Template string `json:"template"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	trimmed := strings.TrimSpace(req.Template)
	if trimmed == "" {
		if err := h.store.DeleteSetting(ctx, "pr-template"); err != nil {
			writeDBError(w, err)
			return
		}
	} else {
		if err := h.store.SetSetting(ctx, "pr-template", trimmed); err != nil {
			writeDBError(w, err)
			return
		}
	}

	writeJSON(w, map[string]string{"status": "ok"})
}

// PRDashboardItem represents a PR in the dashboard
type PRDashboardItem struct {
	// PR metadata
	Number         int              `json:"number"`
	Title          string           `json:"title"`
	State          string           `json:"state"`
	HTMLURL        string           `json:"htmlUrl"`
	IsDraft        bool             `json:"isDraft"`
	Mergeable      *bool            `json:"mergeable"`
	MergeableState string           `json:"mergeableState"`
	CheckStatus    string           `json:"checkStatus"`
	CheckDetails   []interface{}    `json:"checkDetails"`
	Labels         []github.PRLabel `json:"labels"`

	// Branch info
	Branch     string `json:"branch"`
	BaseBranch string `json:"baseBranch"`

	// Session info (if created from ChatML)
	SessionID   string `json:"sessionId,omitempty"`
	SessionName string `json:"sessionName,omitempty"`

	// Workspace info
	WorkspaceID   string `json:"workspaceId"`
	WorkspaceName string `json:"workspaceName"`
	RepoOwner     string `json:"repoOwner"`
	RepoName      string `json:"repoName"`

	// Counts for summary
	ChecksTotal  int `json:"checksTotal"`
	ChecksPassed int `json:"checksPassed"`
	ChecksFailed int `json:"checksFailed"`
}

// prURLPattern matches GitHub PR URLs like https://github.com/owner/repo/pull/123
var prURLPattern = regexp.MustCompile(`github\.com/([^/]+)/([^/]+)/pull/(\d+)`)

type ResolvePRRequest struct {
	URL string `json:"url"`
}

type ResolvePRResponse struct {
	Owner              string   `json:"owner"`
	Repo               string   `json:"repo"`
	PRNumber           int      `json:"prNumber"`
	Title              string   `json:"title"`
	Body               string   `json:"body"`
	Branch             string   `json:"branch"`
	BaseBranch         string   `json:"baseBranch"`
	State              string   `json:"state"`
	IsDraft            bool     `json:"isDraft"`
	Labels             []string `json:"labels"`
	Reviewers          []string `json:"reviewers"`
	Additions          int      `json:"additions"`
	Deletions          int      `json:"deletions"`
	ChangedFiles       int      `json:"changedFiles"`
	MatchedWorkspaceID string   `json:"matchedWorkspaceId,omitempty"`
	HTMLURL            string   `json:"htmlUrl"`
}

// ResolvePR parses a GitHub PR URL and returns detailed PR information plus matched workspace
func (h *Handlers) ResolvePR(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	if h.ghClient == nil {
		writeValidationError(w, "GitHub client not configured")
		return
	}

	var req ResolvePRRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}

	// Parse PR URL
	matches := prURLPattern.FindStringSubmatch(req.URL)
	if matches == nil || len(matches) < 4 {
		writeValidationError(w, "invalid GitHub PR URL: expected format github.com/owner/repo/pull/number")
		return
	}

	owner := matches[1]
	repoName := matches[2]
	prNumber, err := strconv.Atoi(matches[3])
	if err != nil {
		writeValidationError(w, "invalid PR number in URL")
		return
	}

	// Fetch full PR details from GitHub
	prDetails, err := h.ghClient.GetPRFullDetails(ctx, owner, repoName, prNumber)
	if err != nil {
		writeInternalError(w, "failed to fetch PR details", err)
		return
	}

	// Try to match the PR's repo to a registered workspace
	var matchedWorkspaceID string
	repos, err := h.store.ListRepos(ctx)
	if err == nil {
		for _, repo := range repos {
			repoOwner, repoRepo, err := h.repoManager.GetGitHubRemote(ctx, repo.Path)
			if err != nil {
				continue
			}
			if strings.EqualFold(repoOwner, owner) && strings.EqualFold(repoRepo, repoName) {
				matchedWorkspaceID = repo.ID
				break
			}
		}
	}

	resp := ResolvePRResponse{
		Owner:              owner,
		Repo:               repoName,
		PRNumber:           prDetails.Number,
		Title:              prDetails.Title,
		Body:               prDetails.Body,
		Branch:             prDetails.Branch,
		BaseBranch:         prDetails.BaseBranch,
		State:              prDetails.State,
		IsDraft:            prDetails.IsDraft,
		Labels:             prDetails.Labels,
		Reviewers:          prDetails.Reviewers,
		Additions:          prDetails.Additions,
		Deletions:          prDetails.Deletions,
		ChangedFiles:       prDetails.ChangedFiles,
		MatchedWorkspaceID: matchedWorkspaceID,
		HTMLURL:            prDetails.HTMLURL,
	}

	writeJSON(w, resp)
}

// ListPRs returns all open PRs across workspaces fetched directly from GitHub
func (h *Handlers) ListPRs(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Check if GitHub client is available
	if h.ghClient == nil {
		writeJSON(w, []PRDashboardItem{})
		return
	}

	// Optional workspace filter
	workspaceID := r.URL.Query().Get("workspaceId")

	// Get all repos (or specific repo if filtered)
	var repos []*models.Repo
	var err error
	if workspaceID != "" {
		repo, err := h.store.GetRepo(ctx, workspaceID)
		if err != nil {
			writeDBError(w, err)
			return
		}
		if repo == nil {
			writeNotFound(w, "workspace")
			return
		}
		repos = []*models.Repo{repo}
	} else {
		repos, err = h.store.ListRepos(ctx)
		if err != nil {
			writeDBError(w, err)
			return
		}
	}

	// Collect all PRs
	var prItems []PRDashboardItem

	for _, repo := range repos {
		// Get GitHub remote info for this repo
		owner, repoName, err := h.repoManager.GetGitHubRemote(ctx, repo.Path)
		if err != nil {
			// Skip repos without GitHub remote
			continue
		}

		// Check unified PR cache (list + details) with stale-while-revalidate
		cacheEntry, freshness := h.prCache.GetWithStale(owner, repoName)

		var ghPRs []github.PRListItem
		var prDetailsMap map[int]*github.PRDetails

		switch freshness {
		case github.CacheFresh:
			// Serve directly from cache -- zero API calls
			ghPRs = cacheEntry.PRs
			prDetailsMap = cacheEntry.Details

			// If details are missing (previous fetch failed), trigger background refresh
			if len(prDetailsMap) == 0 && len(ghPRs) > 0 {
				if h.prCache.TryStartRefresh(owner, repoName) {
					h.goBackground(func() { h.refreshPRCache(owner, repoName) })
				}
			}

		case github.CacheStale:
			// Serve stale data immediately, trigger background refresh
			ghPRs = cacheEntry.PRs
			prDetailsMap = cacheEntry.Details

			if h.prCache.TryStartRefresh(owner, repoName) {
				h.goBackground(func() { h.refreshPRCache(owner, repoName) })
			}

		default:
			// Cache miss -- fetch synchronously with ETag capture
			result, fetchErr := h.ghClient.ListOpenPRsWithETag(ctx, owner, repoName, "")
			if fetchErr != nil {
				continue
			}
			ghPRs = result.PRs

			// Batch fetch all PR details
			prNumbers := make([]int, len(ghPRs))
			for i, pr := range ghPRs {
				prNumbers[i] = pr.Number
			}
			var failedPRs []int
			prDetailsMap, failedPRs = h.ghClient.GetPRDetailsBatch(ctx, owner, repoName, prNumbers, 5)
			if len(failedPRs) > 0 {
				logger.Handlers.Warnf("Failed to fetch details for PRs %v in %s/%s", failedPRs, owner, repoName)
			}

			// Only cache if we got details; otherwise cache the PR list without details
			// so the next request retries the detail fetch instead of serving empty details
			if prDetailsMap != nil && len(prDetailsMap) > 0 {
				h.prCache.SetFull(owner, repoName, ghPRs, prDetailsMap, result.ETag)
			}
		}

		// List sessions to match PRs with sessions by branch
		// Include archived sessions since PRs may still be associated with them
		sessions, err := h.store.ListSessions(ctx, repo.ID, true)
		if err != nil {
			sessions = nil // Continue without session matching
		}

		// Build a map of branch -> session for quick lookup
		sessionByBranch := make(map[string]*models.Session)
		if sessions != nil {
			for _, session := range sessions {
				sessionByBranch[session.Branch] = session
			}
		}

		// Process each PR from GitHub
		for _, ghPR := range ghPRs {
			prItem := PRDashboardItem{
				Number:        ghPR.Number,
				Title:         ghPR.Title,
				State:         ghPR.State,
				HTMLURL:       ghPR.HTMLURL,
				IsDraft:       ghPR.IsDraft,
				Branch:        ghPR.Branch,
				BaseBranch:    repo.Branch, // Default branch
				WorkspaceID:   repo.ID,
				WorkspaceName: repo.Name,
				RepoOwner:     owner,
				RepoName:      repoName,
				CheckStatus:   "unknown",
				Labels:        ghPR.Labels,
			}

			// Check if there's a matching session by branch
			if session, ok := sessionByBranch[ghPR.Branch]; ok {
				prItem.SessionID = session.ID
				prItem.SessionName = session.Name
			}

			// Use cached or freshly-fetched PR details
			if prDetailsMap != nil {
				if prDetails, ok := prDetailsMap[ghPR.Number]; ok && prDetails != nil {
					prItem.Mergeable = prDetails.Mergeable
					prItem.MergeableState = prDetails.MergeableState
					prItem.CheckStatus = string(prDetails.CheckStatus)

					// Convert check details
					for _, check := range prDetails.CheckDetails {
						prItem.CheckDetails = append(prItem.CheckDetails, check)
					}

					// Calculate counts
					prItem.ChecksTotal = len(prDetails.CheckDetails)
					for _, check := range prDetails.CheckDetails {
						if check.Status == "completed" {
							if check.Conclusion == "success" || check.Conclusion == "neutral" || check.Conclusion == "skipped" {
								prItem.ChecksPassed++
							} else {
								prItem.ChecksFailed++
							}
						}
					}
				}
			}

			prItems = append(prItems, prItem)
		}
	}

	// Return empty array instead of null
	if prItems == nil {
		prItems = []PRDashboardItem{}
	}

	writeJSON(w, prItems)
}

// refreshPRCache fetches fresh PR data from GitHub in the background
// and updates the unified cache. Called when serving stale data.
// Uses ETag conditional requests to avoid re-fetching unchanged data.
// Respects the prCache shutdown signal so goroutines don't outlive the server.
func (h *Handlers) refreshPRCache(owner, repoName string) {
	defer h.prCache.EndRefresh(owner, repoName)
	defer func() {
		if r := recover(); r != nil {
			logger.Handlers.Errorf("Panic in background PR refresh for %s/%s: %v", owner, repoName, r)
		}
	}()

	ctx, cancel := context.WithTimeout(h.serverCtx, 30*time.Second)
	defer cancel()

	// Use cached ETag for conditional request
	etag := h.prCache.GetETag(owner, repoName)
	result, err := h.ghClient.ListOpenPRsWithETag(ctx, owner, repoName, etag)

	if errors.Is(err, github.ErrNotModified) {
		// Data unchanged -- but if details are missing, fetch them before bumping TTL
		entry, _ := h.prCache.GetWithStale(owner, repoName)
		if entry != nil && len(entry.Details) == 0 && len(entry.PRs) > 0 {
			logger.Handlers.Debugf("Background PR refresh for %s/%s: ETag hit but details missing, fetching details", owner, repoName)
			prNumbers := make([]int, len(entry.PRs))
			for i, pr := range entry.PRs {
				prNumbers[i] = pr.Number
			}
			detailsMap, failedPRs := h.ghClient.GetPRDetailsBatch(ctx, owner, repoName, prNumbers, 5)
			if len(failedPRs) > 0 {
				logger.Handlers.Warnf("Background PR detail fetch: failed for PRs %v in %s/%s", failedPRs, owner, repoName)
			}
			if detailsMap != nil && len(detailsMap) > 0 {
				h.prCache.SetDetails(owner, repoName, detailsMap)
			}
		}
		h.prCache.BumpTTL(owner, repoName)
		logger.Handlers.Debugf("Background PR refresh for %s/%s: not modified (ETag hit)", owner, repoName)
		return
	}
	if err != nil {
		logger.Handlers.Errorf("Background PR refresh failed for %s/%s: %v", owner, repoName, err)
		return
	}

	// Batch fetch all PR details
	prNumbers := make([]int, len(result.PRs))
	for i, pr := range result.PRs {
		prNumbers[i] = pr.Number
	}
	prDetailsMap, failedPRs := h.ghClient.GetPRDetailsBatch(ctx, owner, repoName, prNumbers, 5)
	if len(failedPRs) > 0 {
		logger.Handlers.Warnf("Background PR refresh for %s/%s: failed to fetch details for PRs %v", owner, repoName, failedPRs)
	}

	// Update the unified cache with new ETag
	h.prCache.SetFull(owner, repoName, result.PRs, prDetailsMap, result.ETag)

	logger.Handlers.Debugf("Background PR refresh complete for %s/%s: %d PRs, %d details", owner, repoName, len(result.PRs), len(prDetailsMap))
}
