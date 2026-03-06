package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"strings"
	"sync"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime"
	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime/types"
)

// BedRockClient implements ai.Provider using the AWS Bedrock Converse API.
// Used for lightweight backend tasks (PR generation, summarization, suggestions).
type BedRockClient struct {
	mu             sync.Mutex
	client         *bedrockruntime.Client
	modelID        string // Sonnet ARN/ID for main tasks
	lightModelID   string // Haiku ARN/ID for cheap tasks (titles, suggestions)
	region         string
	profile        string
	authRefreshCmd string // e.g. "aws sso login --profile core-dev" (split on whitespace; no quoted args)
}

// Ensure BedRockClient implements Provider at compile time.
var _ Provider = (*BedRockClient)(nil)

// NewBedRockClient creates a new Bedrock client with the given AWS configuration.
func NewBedRockClient(ctx context.Context, profile, region, modelID, lightModelID, authRefreshCmd string) (*BedRockClient, error) {
	client, err := createBedrockClient(ctx, profile, region)
	if err != nil {
		return nil, fmt.Errorf("creating Bedrock client: %w", err)
	}

	return &BedRockClient{
		client:         client,
		modelID:        modelID,
		lightModelID:   lightModelID,
		region:         region,
		profile:        profile,
		authRefreshCmd: authRefreshCmd,
	}, nil
}

// Name returns the provider name.
func (c *BedRockClient) Name() string { return "bedrock" }

// GeneratePRDescription generates a PR title and body using the Bedrock Converse API.
func (c *BedRockClient) GeneratePRDescription(ctx context.Context, req GeneratePRRequest) (*GeneratePRResponse, error) {
	// Build user message — same logic as Anthropic client
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

	systemPrompt := defaultSystemPrompt
	if req.CustomPrompt != "" {
		systemPrompt = req.CustomPrompt + "\n\n" + defaultSystemPrompt
	}

	text, err := c.converse(ctx, systemPrompt, userMsg.String(), maxTokens, false)
	if err != nil {
		return nil, err
	}
	return parsePRResponse(text), nil
}

// GenerateConversationSummary summarizes a conversation using the Bedrock Converse API.
func (c *BedRockClient) GenerateConversationSummary(ctx context.Context, req GenerateSummaryRequest) (string, error) {
	// Build user message — same truncation logic as Anthropic client
	var userMsg strings.Builder
	userMsg.WriteString(fmt.Sprintf("Conversation: %s\n\n", req.ConversationName))

	messages := req.Messages
	totalChars := 0
	for _, m := range messages {
		totalChars += len(m.Content)
	}

	if totalChars > maxInputChars && len(messages) > 4 {
		firstMessages := messages[:2]
		remaining := messages[2:]
		budgetChars := maxInputChars - len(firstMessages[0].Content) - len(firstMessages[1].Content)
		var lastMessages []SummaryMessage
		for i := len(remaining) - 1; i >= 0; i-- {
			budgetChars -= len(remaining[i].Content)
			if budgetChars < 0 {
				break
			}
			lastMessages = append(lastMessages, remaining[i])
		}
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

	text, err := c.converse(ctx, summarySystemPrompt, userMsg.String(), summaryMaxTokens, false)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(text), nil
}

// GenerateSessionTitle generates a short session title using the Bedrock Converse API.
func (c *BedRockClient) GenerateSessionTitle(ctx context.Context, userMessage string) (string, error) {
	msg := userMessage
	if len(msg) > sessionTitleMaxInput {
		msg = msg[:sessionTitleMaxInput]
	}

	text, err := c.converse(ctx, sessionTitleSystemPrompt, msg, sessionTitleMaxTokens, true)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(text), nil
}

// GenerateSessionSummary summarizes an entire session using the Bedrock Converse API.
func (c *BedRockClient) GenerateSessionSummary(ctx context.Context, req GenerateSessionSummaryRequest) (string, error) {
	// Collect all messages with conversation headers — same logic as Anthropic client
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

	totalChars := 0
	for _, m := range allMessages {
		totalChars += len(m.Content)
	}

	messages := allMessages
	if totalChars > maxInputChars && len(messages) > 4 {
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

	text, err := c.converse(ctx, sessionSummarySystemPrompt, userMsg.String(), summaryMaxTokens, false)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(text), nil
}

// GenerateInputSuggestion generates suggested next prompts using the Bedrock Converse API.
func (c *BedRockClient) GenerateInputSuggestion(ctx context.Context, req SuggestionRequest) (*SuggestionResponse, error) {
	var userMsg strings.Builder

	if req.SessionContext != "" {
		userMsg.WriteString("Session context:\n")
		userMsg.WriteString(req.SessionContext)
		userMsg.WriteString("\n\n")
	}

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

	text, err := c.converse(ctx, suggestionSystemPrompt, userMsg.String(), suggestionMaxTokens, true)
	if err != nil {
		return nil, err
	}

	var suggestion SuggestionResponse
	trimmed := strings.TrimSpace(text)
	if err := json.Unmarshal([]byte(trimmed), &suggestion); err != nil {
		// Model may wrap in markdown fences
		trimmed = strings.TrimPrefix(trimmed, "```json")
		trimmed = strings.TrimPrefix(trimmed, "```")
		trimmed = strings.TrimSuffix(trimmed, "```")
		trimmed = strings.TrimSpace(trimmed)
		if err := json.Unmarshal([]byte(trimmed), &suggestion); err != nil {
			return nil, fmt.Errorf("parsing suggestion JSON: %w", err)
		}
	}

	return &suggestion, nil
}

// converse calls the Bedrock Converse API. On credential expiry, it attempts
// to refresh credentials (if authRefreshCmd is set) and retries once.
func (c *BedRockClient) converse(ctx context.Context, system, userMessage string, maxTokens int, useLightModel bool) (string, error) {
	text, err := c.doConverse(ctx, system, userMessage, maxTokens, useLightModel)
	if err != nil && isCredentialExpiredError(err) && c.authRefreshCmd != "" {
		if refreshErr := c.runAuthRefresh(ctx); refreshErr != nil {
			return "", fmt.Errorf("credential refresh failed: %w (original: %v)", refreshErr, err)
		}
		if reloadErr := c.reloadCredentials(ctx); reloadErr != nil {
			return "", fmt.Errorf("reloading credentials after refresh: %w", reloadErr)
		}
		return c.doConverse(ctx, system, userMessage, maxTokens, useLightModel)
	}
	return text, err
}

// doConverse performs a single Bedrock Converse API call.
func (c *BedRockClient) doConverse(ctx context.Context, system, userMessage string, maxTok int, useLightModel bool) (string, error) {
	modelID := c.modelID
	if useLightModel && c.lightModelID != "" {
		modelID = c.lightModelID
	}
	if modelID == "" {
		return "", fmt.Errorf("no Bedrock model ID configured")
	}

	maxTokens32 := int32(maxTok)

	c.mu.Lock()
	client := c.client
	c.mu.Unlock()

	if client == nil {
		return "", fmt.Errorf("Bedrock client not initialized")
	}

	output, err := client.Converse(ctx, &bedrockruntime.ConverseInput{
		ModelId: aws.String(modelID),
		System: []types.SystemContentBlock{
			&types.SystemContentBlockMemberText{Value: system},
		},
		Messages: []types.Message{
			{
				Role: types.ConversationRoleUser,
				Content: []types.ContentBlock{
					&types.ContentBlockMemberText{Value: userMessage},
				},
			},
		},
		InferenceConfig: &types.InferenceConfiguration{
			MaxTokens: &maxTokens32,
		},
	})
	if err != nil {
		return "", fmt.Errorf("Bedrock Converse API: %w", err)
	}

	msgOutput, ok := output.Output.(*types.ConverseOutputMemberMessage)
	if !ok {
		return "", fmt.Errorf("unexpected Bedrock output type: %T", output.Output)
	}

	if len(msgOutput.Value.Content) == 0 {
		return "", fmt.Errorf("empty response from Bedrock Converse API")
	}

	textBlock, ok := msgOutput.Value.Content[0].(*types.ContentBlockMemberText)
	if !ok {
		return "", fmt.Errorf("unexpected content block type: %T", msgOutput.Value.Content[0])
	}

	return textBlock.Value, nil
}

// runAuthRefresh executes the configured AWS auth refresh command (e.g. "aws sso login --profile core-dev").
// The command is split on whitespace; arguments containing spaces are not supported.
func (c *BedRockClient) runAuthRefresh(ctx context.Context) error {
	parts := strings.Fields(c.authRefreshCmd)
	if len(parts) == 0 {
		return fmt.Errorf("empty auth refresh command")
	}
	cmd := exec.CommandContext(ctx, parts[0], parts[1:]...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("running %q: %w (output: %s)", c.authRefreshCmd, err, string(output))
	}
	return nil
}

// reloadCredentials recreates the Bedrock runtime client with fresh AWS credentials.
func (c *BedRockClient) reloadCredentials(ctx context.Context) error {
	newClient, err := createBedrockClient(ctx, c.profile, c.region)
	if err != nil {
		return err
	}
	c.mu.Lock()
	c.client = newClient
	c.mu.Unlock()
	return nil
}

// createBedrockClient builds a bedrockruntime.Client from AWS config.
func createBedrockClient(ctx context.Context, profile, region string) (*bedrockruntime.Client, error) {
	var opts []func(*awsconfig.LoadOptions) error
	if profile != "" {
		opts = append(opts, awsconfig.WithSharedConfigProfile(profile))
	}
	if region != "" {
		opts = append(opts, awsconfig.WithRegion(region))
	}

	cfg, err := awsconfig.LoadDefaultConfig(ctx, opts...)
	if err != nil {
		return nil, fmt.Errorf("loading AWS config: %w", err)
	}

	return bedrockruntime.NewFromConfig(cfg), nil
}

// isCredentialExpiredError checks if the error is related to expired AWS credentials.
func isCredentialExpiredError(err error) bool {
	if err == nil {
		return false
	}
	// Context errors contain "expired" in "context deadline exceeded" — not credential errors.
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return false
	}
	var accessDenied *types.AccessDeniedException
	if errors.As(err, &accessDenied) {
		return true
	}
	// Also check for common credential error messages from the AWS SDK
	msg := err.Error()
	return strings.Contains(msg, "ExpiredToken") ||
		strings.Contains(msg, "expired") ||
		strings.Contains(msg, "security token") ||
		strings.Contains(msg, "UnauthorizedAccess")
}

// ExtractRegionFromARN extracts the AWS region from a Bedrock inference profile ARN.
// Example: "arn:aws:bedrock:us-east-1:123456:application-inference-profile/abc" → "us-east-1"
// Returns empty string if the input is not a valid ARN.
func ExtractRegionFromARN(arn string) string {
	if !strings.HasPrefix(arn, "arn:") {
		return ""
	}
	parts := strings.SplitN(arn, ":", 5)
	if len(parts) < 4 {
		return ""
	}
	return parts[3]
}
