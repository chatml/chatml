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
	haikuModel    = "claude-haiku-4-5-20251001"
	anthropicURL  = "https://api.anthropic.com/v1/messages"
	apiVersion    = "2023-06-01"
	maxTokens     = 1024
	clientTimeout = 60 * time.Second
)

// Client is a lightweight Anthropic API client for generating PR descriptions.
type Client struct {
	authHeader string // HTTP header name: "x-api-key" or "Authorization"
	authValue  string // Header value: raw API key or "Bearer <token>"
	httpClient *http.Client
	model      string
	apiURL     string // Override for testing; defaults to anthropicURL
}

// AuthHeader returns the HTTP header name used for authentication (for testing).
func (c *Client) AuthHeader() string { return c.authHeader }

// AuthValue returns the HTTP header value used for authentication (for testing).
func (c *Client) AuthValue() string { return c.authValue }

// NewClient creates a new AI client using an API key (x-api-key header).
// Returns nil if apiKey is empty.
func NewClient(apiKey string) *Client {
	if apiKey == "" {
		return nil
	}
	return &Client{
		authHeader: "x-api-key",
		authValue:  apiKey,
		httpClient: &http.Client{Timeout: clientTimeout},
		model:      defaultModel,
		apiURL:     anthropicURL,
	}
}

// NewClientWithOAuth creates a new AI client using an OAuth access token (Authorization: Bearer header).
// Returns nil if token is empty.
func NewClientWithOAuth(accessToken string) *Client {
	if accessToken == "" {
		return nil
	}
	return &Client{
		authHeader: "Authorization",
		authValue:  "Bearer " + accessToken,
		httpClient: &http.Client{Timeout: clientTimeout},
		model:      defaultModel,
		apiURL:     anthropicURL,
	}
}

// NewTestClient creates a client with a custom API URL for testing.
func NewTestClient(apiKey, apiURL string) *Client {
	c := NewClient(apiKey)
	if c != nil {
		c.apiURL = apiURL
	}
	return c
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
	httpReq.Header.Set(c.authHeader, c.authValue)
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
	httpReq.Header.Set(c.authHeader, c.authValue)
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

const sessionTitleSystemPrompt = `Generate a short title for an AI coding session based on the user's message.

Rules:
- Use imperative mood (e.g., "Fix login bug", "Add dark mode")
- 3-7 words, max 50 characters
- Output ONLY the title, nothing else
- No quotes, no punctuation at the end
- Be specific to the task described`

const sessionTitleMaxTokens = 60
const sessionTitleMaxInput = 500

// GenerateSessionTitle calls the Anthropic API to generate a short session title from the user's first message.
func (c *Client) GenerateSessionTitle(ctx context.Context, userMessage string) (string, error) {
	if c == nil {
		return "", fmt.Errorf("AI client not configured (missing ANTHROPIC_API_KEY)")
	}

	// Truncate input to avoid wasting tokens
	msg := userMessage
	if len(msg) > sessionTitleMaxInput {
		msg = msg[:sessionTitleMaxInput]
	}

	apiReq := anthropicRequest{
		Model:     haikuModel,
		MaxTokens: sessionTitleMaxTokens,
		System:    sessionTitleSystemPrompt,
		Messages: []anthropicMessage{
			{Role: "user", Content: msg},
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
	httpReq.Header.Set(c.authHeader, c.authValue)
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

// ConversationMessages holds a conversation's metadata and messages for session summarization.
type ConversationMessages struct {
	Name     string           `json:"name"`
	Type     string           `json:"type"` // "task", "review", "chat"
	Messages []SummaryMessage `json:"messages"`
}

// GenerateSessionSummaryRequest contains the context to summarize an entire session.
type GenerateSessionSummaryRequest struct {
	SessionName   string                 `json:"sessionName"`
	Task          string                 `json:"task"`
	Conversations []ConversationMessages `json:"conversations"`
}

const sessionSummarySystemPrompt = `Summarize this coding session concisely (200-500 words). The session may contain multiple conversations (task, review, chat). Capture:
1. Goal/task that was being worked on
2. Key decisions and approach taken
3. Files modified or created
4. Issues encountered and how they were resolved
5. Current state: what was completed vs what remains

Focus on providing useful context for someone deciding whether to restore this archived session. Be specific about what was accomplished. Technical language, no meta-commentary.`

// maxMessageChars caps individual message content to prevent a single huge message
// from consuming the entire budget.
const maxMessageChars = 50000

// taggedMessage pairs a message with its conversation header for correct reconstruction after truncation.
type taggedMessage struct {
	SummaryMessage
	ConvHeader string // e.g. "=== Conversation: Name (type) ==="
}

// GenerateSessionSummary calls the Anthropic API to summarize an entire session across all its conversations.
func (c *Client) GenerateSessionSummary(ctx context.Context, req GenerateSessionSummaryRequest) (string, error) {
	if c == nil {
		return "", fmt.Errorf("AI client not configured (missing ANTHROPIC_API_KEY)")
	}

	// Collect all messages, tagging each with its conversation header
	var allMessages []taggedMessage
	for _, conv := range req.Conversations {
		header := fmt.Sprintf("=== Conversation: %s (%s) ===", conv.Name, conv.Type)
		for _, m := range conv.Messages {
			content := m.Content
			if len(content) > maxMessageChars {
				content = content[:maxMessageChars] + "\n[...message truncated...]"
			}
			allMessages = append(allMessages, taggedMessage{
				SummaryMessage: SummaryMessage{Role: m.Role, Content: content},
				ConvHeader:     header,
			})
		}
	}

	// Calculate total chars and truncate if needed
	totalChars := 0
	for _, m := range allMessages {
		totalChars += len(m.Content)
	}

	messages := allMessages
	if totalChars > maxInputChars && len(messages) > 4 {
		// Keep first 2 messages and trim from the middle
		firstMessages := messages[:2]
		remaining := messages[2:]
		budgetChars := maxInputChars - len(firstMessages[0].Content) - len(firstMessages[1].Content)
		var lastMessages []taggedMessage
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
		omitted := len(allMessages) - len(firstMessages) - len(lastMessages)
		messages = firstMessages
		if omitted > 0 {
			messages = append(messages, taggedMessage{
				SummaryMessage: SummaryMessage{
					Role:    "system",
					Content: fmt.Sprintf("[...%d messages omitted...]", omitted),
				},
				ConvHeader: firstMessages[len(firstMessages)-1].ConvHeader,
			})
		}
		messages = append(messages, lastMessages...)
	}

	// Build user message, inserting conversation headers at boundaries
	var userMsg strings.Builder
	userMsg.WriteString(fmt.Sprintf("Session: %s\n", req.SessionName))
	if req.Task != "" {
		userMsg.WriteString(fmt.Sprintf("Task: %s\n", req.Task))
	}
	userMsg.WriteString("\n")

	currentHeader := ""
	for _, m := range messages {
		if m.ConvHeader != currentHeader {
			currentHeader = m.ConvHeader
			userMsg.WriteString(currentHeader + "\n\n")
		}
		role := strings.ToUpper(m.Role[:1]) + m.Role[1:]
		userMsg.WriteString(fmt.Sprintf("--- %s ---\n%s\n\n", role, m.Content))
	}

	apiReq := anthropicRequest{
		Model:     c.model,
		MaxTokens: summaryMaxTokens,
		System:    sessionSummarySystemPrompt,
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
	httpReq.Header.Set(c.authHeader, c.authValue)
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

// SuggestionPill represents a clickable suggestion option.
type SuggestionPill struct {
	Label string `json:"label"`
	Value string `json:"value"`
}

// SuggestionToolAction is a simplified tool action for suggestion context.
type SuggestionToolAction struct {
	Tool    string `json:"tool"`
	Summary string `json:"summary,omitempty"`
	Success *bool  `json:"success,omitempty"`
}

// SuggestionRequest contains the agent's last output for generating input suggestions.
type SuggestionRequest struct {
	AgentText   string                 `json:"agentText"`
	ToolActions []SuggestionToolAction `json:"toolActions,omitempty"`
}

// SuggestionResponse contains the AI-generated input suggestion.
type SuggestionResponse struct {
	GhostText string           `json:"ghost_text"`
	Pills     []SuggestionPill `json:"pills"`
}

const suggestionSystemPrompt = `You suggest what the user should say next to an AI coding assistant based on the assistant's last output.

You will receive the assistant's last text output and a list of actions it performed (tools used, files edited, etc.).

Rules:
- Suggest a natural follow-up based on what the assistant just did
- If the assistant completed a task: suggest reviewing, testing, committing, or extending the work
- If the assistant asked the user a question: provide 2-3 short pill answers the user can click, plus ghost_text with the most likely answer
- If the assistant just read/explored code: suggest asking for changes, explanations, or next steps
- If no suggestion is appropriate, return empty ghost_text and empty pills array
- ghost_text should be 5-15 words, natural language, imperative mood
- pill labels should be 2-4 words; pill values should be complete sentences the user would type
- Output valid JSON only, no markdown fences, no extra text

Output format:
{"ghost_text": "...", "pills": [{"label": "...", "value": "..."}]}`

const suggestionMaxTokens = 200
const suggestionMaxInputChars = 2000

// GenerateInputSuggestion calls the Anthropic API to generate a suggested next prompt
// based on recent conversation messages. Returns an empty suggestion on error.
func (c *Client) GenerateInputSuggestion(ctx context.Context, req SuggestionRequest) (*SuggestionResponse, error) {
	if c == nil {
		return nil, fmt.Errorf("AI client not configured")
	}

	// Build user message from agent's last output, capping total chars
	var userMsg strings.Builder

	// Include tool actions summary if available
	if len(req.ToolActions) > 0 {
		userMsg.WriteString("Actions performed:\n")
		for _, action := range req.ToolActions {
			status := ""
			if action.Success != nil && !*action.Success {
				status = " [FAILED]"
			}
			if action.Summary != "" {
				userMsg.WriteString(fmt.Sprintf("- %s: %s%s\n", action.Tool, action.Summary, status))
			} else {
				userMsg.WriteString(fmt.Sprintf("- %s%s\n", action.Tool, status))
			}
		}
		userMsg.WriteString("\n")
	}

	// Include agent text output, truncated to fit
	if req.AgentText != "" {
		text := req.AgentText
		remaining := suggestionMaxInputChars - userMsg.Len()
		if remaining > 0 {
			if len(text) > remaining {
				text = text[:remaining]
			}
			userMsg.WriteString("Assistant output:\n")
			userMsg.WriteString(text)
			userMsg.WriteString("\n")
		}
	}

	apiReq := anthropicRequest{
		Model:     haikuModel,
		MaxTokens: suggestionMaxTokens,
		System:    suggestionSystemPrompt,
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
	httpReq.Header.Set(c.authHeader, c.authValue)
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
		return &SuggestionResponse{}, nil
	}

	// Parse JSON response
	var suggestion SuggestionResponse
	text := strings.TrimSpace(apiResp.Content[0].Text)
	if err := json.Unmarshal([]byte(text), &suggestion); err != nil {
		// Haiku may wrap in markdown fences — try stripping them
		text = strings.TrimPrefix(text, "```json")
		text = strings.TrimPrefix(text, "```")
		text = strings.TrimSuffix(text, "```")
		text = strings.TrimSpace(text)
		if err := json.Unmarshal([]byte(text), &suggestion); err != nil {
			return nil, fmt.Errorf("parsing suggestion JSON: %w", err)
		}
	}

	return &suggestion, nil
}
