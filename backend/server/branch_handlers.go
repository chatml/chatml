package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"

	"github.com/chatml/chatml-backend/git"
	"github.com/chatml/chatml-backend/logger"
	"github.com/chatml/chatml-backend/models"
	"github.com/go-chi/chi/v5"
)

func (h *Handlers) ListBranches(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	workspaceID := chi.URLParam(r, "id")

	// Get the workspace
	repo, err := h.store.GetRepo(ctx, workspaceID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if repo == nil {
		writeNotFound(w, "workspace")
		return
	}

	// Parse query parameters
	query := r.URL.Query()
	includeRemote := query.Get("includeRemote") != "false" // default true
	limit := 50
	if l := query.Get("limit"); l != "" {
		fmt.Sscanf(l, "%d", &limit)
	}
	offset := 0
	if o := query.Get("offset"); o != "" {
		fmt.Sscanf(o, "%d", &offset)
	}
	search := query.Get("search")
	sortBy := query.Get("sortBy")
	if sortBy == "" {
		sortBy = "date"
	}

	// Build cache key - cache the full list, apply filtering after
	cacheKey := fmt.Sprintf("%s:remote=%v:sort=%s", repo.Path, includeRemote, sortBy)

	// Check cache first
	branchResult, cacheHit := h.branchCache.Get(cacheKey)
	if !cacheHit {
		// Auto-prune stale remote-tracking refs to prevent inflated branch counts.
		// Only prune when including remote branches — local-only listings aren't
		// affected by stale remote-tracking refs and this avoids unnecessary work.
		if includeRemote && h.branchCache.ShouldPrune(repo.Path) {
			if pruneErr := h.repoManager.PruneRemoteRefs(ctx, repo.Path); pruneErr != nil {
				logger.Handlers.Warnf("Auto-prune failed for %s: %v", repo.Path, pruneErr)
			} else {
				h.branchCache.MarkPruned(repo.Path)
			}
		}

		// Get branches from git
		branchOpts := git.BranchListOptions{
			IncludeRemote: includeRemote,
			Limit:         0, // Fetch all for caching
			Offset:        0,
			Search:        "", // Don't filter in git, we'll filter cached results
			SortBy:        sortBy,
			SortDesc:      true, // Most recent first for date sort
		}

		var err error
		branchResult, err = h.repoManager.ListBranches(ctx, repo.Path, branchOpts)
		if err != nil {
			writeInternalError(w, "failed to list branches", err)
			return
		}

		// Cache the result
		h.branchCache.Set(cacheKey, branchResult)
	}

	// Apply search filter on cached results if needed
	filteredBranches := branchResult.Branches
	if search != "" {
		searchLower := strings.ToLower(search)
		var filtered []git.BranchInfo
		for _, b := range branchResult.Branches {
			if strings.Contains(strings.ToLower(b.Name), searchLower) {
				filtered = append(filtered, b)
			}
		}
		filteredBranches = filtered
	}

	// Deduplicate: when remote branches are included, remove remote entries
	// that have a matching local branch (e.g., skip "origin/feature" if "feature" exists locally).
	if includeRemote {
		localNames := make(map[string]bool)
		for _, b := range filteredBranches {
			if !b.IsRemote {
				localNames[b.Name] = true
			}
		}
		var deduped []git.BranchInfo
		for _, b := range filteredBranches {
			if b.IsRemote {
				remoteName := strings.TrimPrefix(b.Name, "origin/")
				if localNames[remoteName] {
					continue // Skip remote duplicate — local copy is shown
				}
			}
			deduped = append(deduped, b)
		}
		filteredBranches = deduped
	}

	// Apply pagination
	total := len(filteredBranches)
	start := offset
	if start > total {
		start = total
	}
	end := start + limit
	if end > total {
		end = total
	}
	paginatedBranches := filteredBranches[start:end]

	// Create result with pagination info
	branchResult = &git.BranchListResult{
		Branches: paginatedBranches,
		Total:    total,
		HasMore:  end < total,
	}

	// Get current branch
	currentBranch, branchErr := h.repoManager.GetCurrentBranch(ctx, repo.Path)
	if branchErr != nil {
		logger.Handlers.Warnf("Failed to get current branch for %s: %v", repo.Path, branchErr)
	}

	// Get all sessions (including archived) to build branch -> session lookup.
	// Archived sessions may still have PR data for branches that exist in git.
	sessions, err := h.store.ListSessions(ctx, workspaceID, true)
	if err != nil {
		writeDBError(w, err)
		return
	}

	// Build branch -> session lookup map
	branchToSession := make(map[string]*models.Session)
	for _, sess := range sessions {
		if sess.Branch != "" {
			branchToSession[sess.Branch] = sess
		}
	}

	// Separate branches into session-linked and other
	var sessionBranches []models.BranchWithSession
	var otherBranches []models.BranchWithSession

	for _, branch := range branchResult.Branches {
		bws := models.BranchWithSession{
			BranchInfo: models.BranchInfo{
				Name:              branch.Name,
				IsRemote:          branch.IsRemote,
				IsHead:            branch.IsHead,
				LastCommitSHA:     branch.LastCommitSHA,
				LastCommitDate:    branch.LastCommitDate,
				LastCommitSubject: branch.LastCommitSubject,
				LastAuthor:        branch.LastAuthor,
				LastAuthorEmail:   branch.LastAuthorEmail,
				AheadMain:         branch.AheadMain,
				BehindMain:        branch.BehindMain,
				Prefix:            branch.Prefix,
			},
		}

		// Check if this branch has an associated session
		if sess, ok := branchToSession[branch.Name]; ok {
			bws.SessionID = sess.ID
			bws.SessionName = sess.Name
			bws.SessionStatus = sess.Status
			bws.PRNumber = sess.PRNumber
			bws.PRStatus = sess.PRStatus
			bws.PRUrl = sess.PRUrl
			bws.CheckStatus = sess.CheckStatus
			bws.HasMergeConflict = sess.HasMergeConflict
			sessionBranches = append(sessionBranches, bws)
		} else {
			otherBranches = append(otherBranches, bws)
		}
	}

	response := models.BranchListResponse{
		SessionBranches: sessionBranches,
		OtherBranches:   otherBranches,
		CurrentBranch:   currentBranch,
		Total:           branchResult.Total,
		HasMore:         branchResult.HasMore,
	}

	// Ensure empty slices are serialized as [] not null
	if response.SessionBranches == nil {
		response.SessionBranches = []models.BranchWithSession{}
	}
	if response.OtherBranches == nil {
		response.OtherBranches = []models.BranchWithSession{}
	}

	writeJSON(w, response)
}

// getSessionBranchMap builds a mapping from branch name to session info for a workspace.
// Includes archived sessions so their branches are protected during branch cleanup.
func (h *Handlers) getSessionBranchMap(ctx context.Context, workspaceID string) (map[string]*git.SessionInfo, error) {
	sessions, err := h.store.ListSessions(ctx, workspaceID, true)
	if err != nil {
		return nil, err
	}

	sessionBranches := make(map[string]*git.SessionInfo)
	for _, sess := range sessions {
		if sess.Branch != "" {
			sessionBranches[sess.Branch] = &git.SessionInfo{
				ID:     sess.ID,
				Name:   sess.Name,
				Status: sess.Status,
			}
		}
	}
	return sessionBranches, nil
}

// AnalyzeBranchCleanup analyzes branches for cleanup and returns categorized candidates
// POST /api/repos/{id}/branches/analyze-cleanup
func (h *Handlers) AnalyzeBranchCleanup(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	workspaceID := chi.URLParam(r, "id")

	// Get the workspace
	repo, err := h.store.GetRepo(ctx, workspaceID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if repo == nil {
		writeNotFound(w, "workspace")
		return
	}

	// Parse request body
	var req git.CleanupAnalysisRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}
	if req.StaleDaysThreshold <= 0 {
		req.StaleDaysThreshold = 90
	}

	// Prune stale remote-tracking refs before analysis so we don't suggest
	// deleting branches that are already gone on the remote.
	if req.IncludeRemote {
		if pruneErr := h.repoManager.PruneRemoteRefs(ctx, repo.Path); pruneErr != nil {
			logger.Handlers.Warnf("Pre-analysis prune failed for %s: %v", repo.Path, pruneErr)
		} else {
			h.branchCache.MarkPruned(repo.Path)
			h.branchCache.InvalidateRepo(repo.Path)
		}
	}

	// Get sessions for branch -> session mapping
	sessionBranches, err := h.getSessionBranchMap(ctx, workspaceID)
	if err != nil {
		writeDBError(w, err)
		return
	}

	// Run analysis
	response, err := h.repoManager.AnalyzeBranchesForCleanup(
		ctx, repo.Path, req.StaleDaysThreshold, req.IncludeRemote, sessionBranches,
	)
	if err != nil {
		writeInternalError(w, "failed to analyze branches", err)
		return
	}

	writeJSON(w, response)
}

// ExecuteBranchCleanup deletes the specified branches
// POST /api/repos/{id}/branches/cleanup
func (h *Handlers) ExecuteBranchCleanup(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	workspaceID := chi.URLParam(r, "id")

	// Get the workspace
	repo, err := h.store.GetRepo(ctx, workspaceID)
	if err != nil {
		writeDBError(w, err)
		return
	}
	if repo == nil {
		writeNotFound(w, "workspace")
		return
	}

	// Parse request body
	var req git.CleanupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeValidationError(w, "invalid request body")
		return
	}
	if len(req.Branches) == 0 {
		writeValidationError(w, "no branches specified")
		return
	}

	// Get sessions for safety checks
	sessionBranches, err := h.getSessionBranchMap(ctx, workspaceID)
	if err != nil {
		writeDBError(w, err)
		return
	}

	// Execute cleanup
	result, err := h.repoManager.DeleteBranches(ctx, repo.Path, req.Branches, sessionBranches)
	if err != nil {
		writeInternalError(w, "failed to delete branches", err)
		return
	}

	// Invalidate branch cache and notify clients
	h.branchCache.InvalidateRepo(repo.Path)
	if h.hub != nil {
		h.hub.Broadcast(Event{
			Type: "branch_dashboard_update",
			Payload: map[string]interface{}{
				"reason":    "branch_cleanup",
				"succeeded": len(result.Succeeded),
				"failed":    len(result.Failed),
			},
		})
	}

	writeJSON(w, result)
}

// GetAvatars returns GitHub avatar URLs for a batch of email addresses
// GET /api/avatars?emails=email1@example.com,email2@example.com
func (h *Handlers) GetAvatars(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Parse emails from query parameter
	emailsParam := r.URL.Query().Get("emails")
	if emailsParam == "" {
		writeJSON(w, map[string]interface{}{"avatars": map[string]string{}})
		return
	}

	emails := strings.Split(emailsParam, ",")
	if len(emails) == 0 {
		writeJSON(w, map[string]interface{}{"avatars": map[string]string{}})
		return
	}

	// Limit batch size to prevent abuse
	if len(emails) > 50 {
		emails = emails[:50]
	}

	// Check cache for existing entries
	cached, needLookup := h.avatarCache.GetMultiple(emails)

	// If we have all entries cached, return immediately
	if len(needLookup) == 0 {
		writeJSON(w, map[string]interface{}{"avatars": cached})
		return
	}

	// Look up missing emails from GitHub API (parallel with bounded concurrency)
	sem := make(chan struct{}, 5)
	var wg sync.WaitGroup
	var mu sync.Mutex

	for _, email := range needLookup {
		email = strings.TrimSpace(email)
		if email == "" {
			continue
		}

		wg.Add(1)
		go func(email string) {
			defer wg.Done()

			// Context-aware semaphore acquisition
			select {
			case sem <- struct{}{}:
				defer func() { <-sem }()
			case <-ctx.Done():
				return
			}

			avatarURL, err := h.ghClient.GetAvatarByEmail(ctx, email)
			if err != nil {
				// Don't cache on error (e.g. rate limit, transient 5xx) —
				// let the next request retry instead of poisoning the cache.
				logger.Handlers.Debugf("Failed to get avatar for %s: %v", email, err)
				return
			}

			if avatarURL == "" {
				h.avatarCache.SetNotFound(email)
				mu.Lock()
				cached[email] = ""
				mu.Unlock()
			} else {
				h.avatarCache.Set(email, avatarURL)
				mu.Lock()
				cached[email] = avatarURL
				mu.Unlock()
			}
		}(email)
	}

	wg.Wait()

	writeJSON(w, map[string]interface{}{"avatars": cached})
}
