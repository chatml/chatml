package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const (
	defaultModel  = "claude-sonnet-4-20250514"
	anthropicURL  = "https://api.anthropic.com/v1/messages"
	apiVersion    = "2023-06-01"
	maxTokens     = 1024
	clientTimeout = 60 * time.Second
)

// Client is a lightweight Anthropic API client for generating PR descriptions.
type Client struct {
	apiKey     string
	httpClient *http.Client
	model      string
	apiURL     string // Override for testing; defaults to anthropicURL
}

// NewClient creates a new AI client. Returns nil if apiKey is empty.
func NewClient(apiKey string) *Client {
	if apiKey == "" {
		return nil
	}
	return &Client{
		apiKey:     apiKey,
		httpClient: &http.Client{Timeout: clientTimeout},
		model:      defaultModel,
		apiURL:     anthropicURL,
	}
}

// CommitInfo is a simplified commit representation for PR generation.
type CommitInfo struct {
	SHA     string `json:"sha"`
	Message string `json:"message"`
	Author  string `json:"author"`
	Files   int    `json:"files"`
}

// GeneratePRRequest contains the context needed to generate a PR description.
type GeneratePRRequest struct {
	Commits      []CommitInfo `json:"commits"`
	DiffSummary  string       `json:"diffSummary"`
	BranchName   string       `json:"branchName"`
	BaseBranch   string       `json:"baseBranch"`
	CustomPrompt string       `json:"customPrompt"` // Per-repo custom prompt (optional)
}

// GeneratePRResponse contains the AI-generated PR title and body.
type GeneratePRResponse struct {
	Title string `json:"title"`
	Body  string `json:"body"`
}

// anthropicRequest is the request body for the Anthropic Messages API.
type anthropicRequest struct {
	Model     string              `json:"model"`
	MaxTokens int                 `json:"max_tokens"`
	System    string              `json:"system"`
	Messages  []anthropicMessage  `json:"messages"`
}

type anthropicMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// anthropicResponse is the response from the Anthropic Messages API.
type anthropicResponse struct {
	Content []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"content"`
}

const defaultSystemPrompt = `You generate pull request titles and descriptions from git commits and diffs.

Output EXACTLY this format with no extra text:

TITLE: <concise PR title under 72 chars>

BODY:
<markdown PR description>

Guidelines:
- Title: imperative mood, concise summary (e.g., "Add user authentication flow")
- Body: summarize what changed and why, using bullet points for multiple changes
- Reference file names when helpful
- Keep it professional and concise`

// GeneratePRDescription calls the Anthropic API to generate a PR title and body.
func (c *Client) GeneratePRDescription(ctx context.Context, req GeneratePRRequest) (*GeneratePRResponse, error) {
	if c == nil {
		return nil, fmt.Errorf("AI client not configured (missing ANTHROPIC_API_KEY)")
	}

	// Build the user message with commit context
	var userMsg strings.Builder
	userMsg.WriteString(fmt.Sprintf("Branch: %s → %s\n\n", req.BranchName, req.BaseBranch))

	userMsg.WriteString("Commits:\n")
	for _, commit := range req.Commits {
		sha := commit.SHA
		if len(sha) > 7 {
			sha = sha[:7]
		}
		userMsg.WriteString(fmt.Sprintf("- %s: %s (%d files)\n", sha, commit.Message, commit.Files))
	}

	if req.DiffSummary != "" {
		userMsg.WriteString("\n")
		userMsg.WriteString(req.DiffSummary)
	}

	// Use custom prompt if provided, otherwise use default
	systemPrompt := defaultSystemPrompt
	if req.CustomPrompt != "" {
		systemPrompt = req.CustomPrompt + "\n\n" + defaultSystemPrompt
	}

	apiReq := anthropicRequest{
		Model:     c.model,
		MaxTokens: maxTokens,
		System:    systemPrompt,
		Messages: []anthropicMessage{
			{Role: "user", Content: userMsg.String()},
		},
	}

	body, err := json.Marshal(apiReq)
	if err != nil {
		return nil, fmt.Errorf("marshaling request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", c.apiURL, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("x-api-key", c.apiKey)
	httpReq.Header.Set("anthropic-version", apiVersion)

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("calling Anthropic API: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("Anthropic API returned %d: %s", resp.StatusCode, respBody)
	}

	var apiResp anthropicResponse
	if err := json.NewDecoder(resp.Body).Decode(&apiResp); err != nil {
		return nil, fmt.Errorf("decoding response: %w", err)
	}

	if len(apiResp.Content) == 0 {
		return nil, fmt.Errorf("empty response from Anthropic API")
	}

	// Parse the TITLE: / BODY: format from the response
	return parsePRResponse(apiResp.Content[0].Text), nil
}

// SummaryMessage is a simplified message representation for summarization.
type SummaryMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// GenerateSummaryRequest contains the messages to summarize.
type GenerateSummaryRequest struct {
	ConversationName string           `json:"conversationName"`
	Messages         []SummaryMessage `json:"messages"`
}

const summarySystemPrompt = `Summarize this AI coding conversation concisely (200-500 words). Capture:
1. Task/goal
2. Key decisions and rationale
3. Files modified/created
4. Issues encountered and resolutions
5. Current state: completed vs remaining work

Focus on context useful for follow-up conversations. Technical language, no meta-commentary.`

const summaryMaxTokens = 2048
const maxInputChars = 400000 // ~100K tokens at 4 chars/token

// GenerateConversationSummary calls the Anthropic API to summarize a conversation.
func (c *Client) GenerateConversationSummary(ctx context.Context, req GenerateSummaryRequest) (string, error) {
	if c == nil {
		return "", fmt.Errorf("AI client not configured (missing ANTHROPIC_API_KEY)")
	}

	// Build user message from conversation messages
	var userMsg strings.Builder
	userMsg.WriteString(fmt.Sprintf("Conversation: %s\n\n", req.ConversationName))

	// Truncate if too long: keep first 2 and last N messages
	messages := req.Messages
	totalChars := 0
	for _, m := range messages {
		totalChars += len(m.Content)
	}

	if totalChars > maxInputChars && len(messages) > 4 {
		// Keep first 2 messages and trim from the middle
		firstMessages := messages[:2]
		remaining := messages[2:]
		// Work backwards to find how many we can fit
		budgetChars := maxInputChars - len(firstMessages[0].Content) - len(firstMessages[1].Content)
		var lastMessages []SummaryMessage
		for i := len(remaining) - 1; i >= 0; i-- {
			budgetChars -= len(remaining[i].Content)
			if budgetChars < 0 {
				break
			}
			lastMessages = append(lastMessages, remaining[i])
		}
		// Reverse to restore chronological order
		for i, j := 0, len(lastMessages)-1; i < j; i, j = i+1, j-1 {
			lastMessages[i], lastMessages[j] = lastMessages[j], lastMessages[i]
		}
		omitted := len(messages) - len(firstMessages) - len(lastMessages)
		messages = firstMessages
		if omitted > 0 {
			messages = append(messages, SummaryMessage{
				Role:    "system",
				Content: fmt.Sprintf("[...%d messages omitted...]", omitted),
			})
		}
		messages = append(messages, lastMessages...)
	}

	for _, m := range messages {
		role := strings.ToUpper(m.Role[:1]) + m.Role[1:]
		userMsg.WriteString(fmt.Sprintf("--- %s ---\n%s\n\n", role, m.Content))
	}

	apiReq := anthropicRequest{
		Model:     c.model,
		MaxTokens: summaryMaxTokens,
		System:    summarySystemPrompt,
		Messages: []anthropicMessage{
			{Role: "user", Content: userMsg.String()},
		},
	}

	body, err := json.Marshal(apiReq)
	if err != nil {
		return "", fmt.Errorf("marshaling request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", c.apiURL, bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("creating request: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("x-api-key", c.apiKey)
	httpReq.Header.Set("anthropic-version", apiVersion)

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return "", fmt.Errorf("calling Anthropic API: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("Anthropic API returned %d: %s", resp.StatusCode, respBody)
	}

	var apiResp anthropicResponse
	if err := json.NewDecoder(resp.Body).Decode(&apiResp); err != nil {
		return "", fmt.Errorf("decoding response: %w", err)
	}

	if len(apiResp.Content) == 0 {
		return "", fmt.Errorf("empty response from Anthropic API")
	}

	return strings.TrimSpace(apiResp.Content[0].Text), nil
}

// parsePRResponse extracts title and body from the AI response text.
func parsePRResponse(text string) *GeneratePRResponse {
	text = strings.TrimSpace(text)

	result := &GeneratePRResponse{}

	// Look for TITLE: prefix
	if idx := strings.Index(text, "TITLE:"); idx != -1 {
		rest := text[idx+len("TITLE:"):]
		// Title ends at the next newline
		if nlIdx := strings.Index(rest, "\n"); nlIdx != -1 {
			result.Title = strings.TrimSpace(rest[:nlIdx])
			rest = rest[nlIdx:]
		} else {
			result.Title = strings.TrimSpace(rest)
			return result
		}

		// Look for BODY: prefix
		if bodyIdx := strings.Index(rest, "BODY:"); bodyIdx != -1 {
			result.Body = strings.TrimSpace(rest[bodyIdx+len("BODY:"):])
		}
	} else {
		// Fallback: first line is title, rest is body
		lines := strings.SplitN(text, "\n", 2)
		result.Title = strings.TrimSpace(lines[0])
		if len(lines) > 1 {
			result.Body = strings.TrimSpace(lines[1])
		}
	}

	return result
}
