package chatml

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/chatml/chatml-backend/models"
	"github.com/chatml/chatml-core/tool"
	"github.com/google/uuid"
)

// --- add_review_comment ---

type addReviewCommentTool struct {
	svc *Services
	ctx *ToolContext
}

func (t *addReviewCommentTool) Name() string        { return "mcp__chatml__add_review_comment" }
func (t *addReviewCommentTool) IsConcurrentSafe() bool { return true }
func (t *addReviewCommentTool) DeferLoading() bool   { return true }
func (t *addReviewCommentTool) Description() string {
	return "Add a code review comment to a specific line in a file. Supports markdown, severity levels, and optional titles."
}
func (t *addReviewCommentTool) InputSchema() json.RawMessage {
	return json.RawMessage(`{
		"type": "object",
		"properties": {
			"filePath": {"type": "string", "description": "Relative path to the file being reviewed"},
			"lineNumber": {"type": "number", "description": "Line number for the comment (1-based)", "minimum": 1},
			"title": {"type": "string", "description": "Short title summarizing the issue"},
			"content": {"type": "string", "description": "The review comment content (supports markdown)"},
			"severity": {"type": "string", "enum": ["error", "warning", "suggestion", "info"], "description": "Severity level"}
		},
		"required": ["filePath", "lineNumber", "content"]
	}`)
}

func (t *addReviewCommentTool) Execute(ctx context.Context, input json.RawMessage) (*tool.Result, error) {
	var params struct {
		FilePath   string `json:"filePath"`
		LineNumber int    `json:"lineNumber"`
		Title      string `json:"title"`
		Content    string `json:"content"`
		Severity   string `json:"severity"`
	}
	if err := json.Unmarshal(input, &params); err != nil {
		return tool.ErrorResult(fmt.Sprintf("invalid input: %v", err)), nil
	}
	if params.FilePath == "" || params.Content == "" {
		return tool.ErrorResult("filePath and content are required"), nil
	}
	if params.LineNumber < 1 {
		return tool.ErrorResult("lineNumber must be >= 1"), nil
	}

	comment := &models.ReviewComment{
		ID:         uuid.New().String(),
		SessionID:  t.ctx.SessionID,
		FilePath:   params.FilePath,
		LineNumber: params.LineNumber,
		Title:      params.Title,
		Content:    params.Content,
		Source:     "claude",
		Author:     "Claude",
		Severity:   params.Severity,
		CreatedAt:  time.Now(),
	}

	if err := t.svc.Store.AddReviewComment(ctx, comment); err != nil {
		return tool.ErrorResult(fmt.Sprintf("failed to add comment: %v", err)), nil
	}

	return &tool.Result{Content: fmt.Sprintf("Review comment added (id: %s) on %s:%d", comment.ID, params.FilePath, params.LineNumber)}, nil
}

// --- list_review_comments ---

type listReviewCommentsTool struct {
	svc *Services
	ctx *ToolContext
}

func (t *listReviewCommentsTool) Name() string        { return "mcp__chatml__list_review_comments" }
func (t *listReviewCommentsTool) IsConcurrentSafe() bool { return true }
func (t *listReviewCommentsTool) DeferLoading() bool   { return true }
func (t *listReviewCommentsTool) Description() string {
	return "List all review comments for the current session, optionally filtered by file."
}
func (t *listReviewCommentsTool) InputSchema() json.RawMessage {
	return json.RawMessage(`{
		"type": "object",
		"properties": {
			"filePath": {"type": "string", "description": "Filter comments by file path"}
		}
	}`)
}

func (t *listReviewCommentsTool) Execute(ctx context.Context, input json.RawMessage) (*tool.Result, error) {
	var params struct {
		FilePath string `json:"filePath"`
	}
	_ = json.Unmarshal(input, &params)

	var comments []*models.ReviewComment
	var err error
	if params.FilePath != "" {
		comments, err = t.svc.Store.ListReviewCommentsForFile(ctx, t.ctx.SessionID, params.FilePath)
	} else {
		comments, err = t.svc.Store.ListReviewComments(ctx, t.ctx.SessionID)
	}
	if err != nil {
		return tool.ErrorResult(fmt.Sprintf("failed to list comments: %v", err)), nil
	}

	if len(comments) == 0 {
		return &tool.Result{Content: "No review comments found."}, nil
	}

	var sb strings.Builder
	for _, c := range comments {
		status := "open"
		if c.Resolved {
			status = fmt.Sprintf("resolved (%s)", c.ResolutionType)
		}
		sb.WriteString(fmt.Sprintf("- [%s] %s:%d", c.ID, c.FilePath, c.LineNumber))
		if c.Title != "" {
			sb.WriteString(fmt.Sprintf(" — %s", c.Title))
		}
		if c.Severity != "" {
			sb.WriteString(fmt.Sprintf(" [%s]", c.Severity))
		}
		sb.WriteString(fmt.Sprintf(" (%s)\n  %s\n", status, c.Content))
	}

	return &tool.Result{Content: sb.String()}, nil
}

// --- resolve_review_comment ---

type resolveReviewCommentTool struct {
	svc *Services
	ctx *ToolContext
}

func (t *resolveReviewCommentTool) Name() string        { return "mcp__chatml__resolve_review_comment" }
func (t *resolveReviewCommentTool) IsConcurrentSafe() bool { return true }
func (t *resolveReviewCommentTool) DeferLoading() bool   { return true }
func (t *resolveReviewCommentTool) Description() string {
	return "Mark a review comment as fixed or ignored after addressing it."
}
func (t *resolveReviewCommentTool) InputSchema() json.RawMessage {
	return json.RawMessage(`{
		"type": "object",
		"properties": {
			"commentId": {"type": "string", "description": "The ID of the review comment to resolve"},
			"resolutionType": {"type": "string", "enum": ["fixed", "ignored"], "description": "Resolution type"}
		},
		"required": ["commentId"]
	}`)
}

func (t *resolveReviewCommentTool) Execute(ctx context.Context, input json.RawMessage) (*tool.Result, error) {
	var params struct {
		CommentID      string `json:"commentId"`
		ResolutionType string `json:"resolutionType"`
	}
	if err := json.Unmarshal(input, &params); err != nil {
		return tool.ErrorResult(fmt.Sprintf("invalid input: %v", err)), nil
	}
	if params.CommentID == "" {
		return tool.ErrorResult("commentId is required"), nil
	}
	if params.ResolutionType == "" {
		params.ResolutionType = "fixed"
	}

	now := time.Now()
	err := t.svc.Store.UpdateReviewComment(ctx, params.CommentID, func(c *models.ReviewComment) {
		c.Resolved = true
		c.ResolvedAt = &now
		c.ResolvedBy = "claude"
		c.ResolutionType = params.ResolutionType
	})
	if err != nil {
		return tool.ErrorResult(fmt.Sprintf("failed to resolve comment: %v", err)), nil
	}

	return &tool.Result{Content: fmt.Sprintf("Comment %s resolved as %s.", params.CommentID, params.ResolutionType)}, nil
}

// --- get_review_comment_stats ---

type getReviewCommentStatsTool struct {
	svc *Services
	ctx *ToolContext
}

func (t *getReviewCommentStatsTool) Name() string        { return "mcp__chatml__get_review_comment_stats" }
func (t *getReviewCommentStatsTool) IsConcurrentSafe() bool { return true }
func (t *getReviewCommentStatsTool) DeferLoading() bool   { return true }
func (t *getReviewCommentStatsTool) Description() string {
	return "Get statistics about review comments including per-file counts of unresolved comments."
}
func (t *getReviewCommentStatsTool) InputSchema() json.RawMessage {
	return json.RawMessage(`{"type": "object", "properties": {}}`)
}

func (t *getReviewCommentStatsTool) Execute(ctx context.Context, input json.RawMessage) (*tool.Result, error) {
	stats, err := t.svc.Store.GetReviewCommentStats(ctx, t.ctx.SessionID)
	if err != nil {
		return tool.ErrorResult(fmt.Sprintf("failed to get stats: %v", err)), nil
	}

	if len(stats) == 0 {
		return &tool.Result{Content: "No review comments found."}, nil
	}

	var sb strings.Builder
	totalUnresolved := 0
	totalComments := 0
	for _, s := range stats {
		sb.WriteString(fmt.Sprintf("- %s: %d unresolved / %d total\n", s.FilePath, s.Unresolved, s.Total))
		totalUnresolved += s.Unresolved
		totalComments += s.Total
	}
	sb.WriteString(fmt.Sprintf("\nOverall: %d unresolved / %d total comments", totalUnresolved, totalComments))

	return &tool.Result{Content: sb.String()}, nil
}

// --- submit_review_scorecard ---

type submitReviewScorecardTool struct {
	svc *Services
	ctx *ToolContext
}

func (t *submitReviewScorecardTool) Name() string        { return "mcp__chatml__submit_review_scorecard" }
func (t *submitReviewScorecardTool) IsConcurrentSafe() bool { return true }
func (t *submitReviewScorecardTool) DeferLoading() bool   { return true }
func (t *submitReviewScorecardTool) Description() string {
	return "Submit a structured review scorecard with dimension scores. Use after completing a product, design, or other review."
}
func (t *submitReviewScorecardTool) InputSchema() json.RawMessage {
	return json.RawMessage(`{
		"type": "object",
		"properties": {
			"reviewType": {"type": "string", "description": "Type of review (e.g., 'product', 'design', 'security')"},
			"scores": {
				"type": "array",
				"items": {
					"type": "object",
					"properties": {
						"dimension": {"type": "string"},
						"score": {"type": "number"},
						"maxScore": {"type": "number"},
						"notes": {"type": "string"}
					},
					"required": ["dimension", "score"]
				}
			},
			"summary": {"type": "string", "description": "Overall summary of the review findings"}
		},
		"required": ["reviewType", "scores", "summary"]
	}`)
}

func (t *submitReviewScorecardTool) Execute(ctx context.Context, input json.RawMessage) (*tool.Result, error) {
	var params struct {
		ReviewType string `json:"reviewType"`
		Scores     []struct {
			Dimension string  `json:"dimension"`
			Score     float64 `json:"score"`
			MaxScore  float64 `json:"maxScore"`
			Notes     string  `json:"notes"`
		} `json:"scores"`
		Summary string `json:"summary"`
	}
	if err := json.Unmarshal(input, &params); err != nil {
		return tool.ErrorResult(fmt.Sprintf("invalid input: %v", err)), nil
	}

	// Format scorecard as a review comment for persistence
	var sb strings.Builder
	reviewTitle := params.ReviewType
	if len(reviewTitle) > 0 {
		reviewTitle = strings.ToUpper(reviewTitle[:1]) + reviewTitle[1:]
	}
	sb.WriteString(fmt.Sprintf("## %s Review Scorecard\n\n", reviewTitle))
	totalScore := 0.0
	totalMax := 0.0
	for _, s := range params.Scores {
		maxScore := s.MaxScore
		if maxScore == 0 {
			maxScore = 10
		}
		sb.WriteString(fmt.Sprintf("- **%s**: %.0f/%.0f", s.Dimension, s.Score, maxScore))
		if s.Notes != "" {
			sb.WriteString(fmt.Sprintf(" — %s", s.Notes))
		}
		sb.WriteString("\n")
		totalScore += s.Score
		totalMax += maxScore
	}
	pct := 0.0
	if totalMax > 0 {
		pct = (totalScore / totalMax) * 100
	}
	sb.WriteString(fmt.Sprintf("\n**Overall**: %.0f/%.0f (%.0f%%)\n\n", totalScore, totalMax, pct))
	sb.WriteString(fmt.Sprintf("**Summary**: %s", params.Summary))

	// Store as a review comment with scorecard metadata
	comment := &models.ReviewComment{
		ID:        uuid.New().String(),
		SessionID: t.ctx.SessionID,
		FilePath:  fmt.Sprintf("_scorecard/%s", params.ReviewType),
		Content:   sb.String(),
		Source:    "claude",
		Author:    "Claude",
		Severity:  "info",
		CreatedAt: time.Now(),
	}
	if err := t.svc.Store.AddReviewComment(ctx, comment); err != nil {
		return tool.ErrorResult(fmt.Sprintf("failed to save scorecard: %v", err)), nil
	}

	return &tool.Result{Content: fmt.Sprintf("Review scorecard submitted (id: %s).\n\n%s", comment.ID, sb.String())}, nil
}
