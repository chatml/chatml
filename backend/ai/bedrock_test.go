package ai

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ---------------------------------------------------------------------------
// ExtractRegionFromARN tests
// ---------------------------------------------------------------------------

func TestExtractRegionFromARN(t *testing.T) {
	tests := []struct {
		name string
		arn  string
		want string
	}{
		{
			"valid inference profile ARN",
			"arn:aws:bedrock:us-east-1:451348473281:application-inference-profile/6atmd50rvy0c",
			"us-east-1",
		},
		{
			"eu-west-1 region",
			"arn:aws:bedrock:eu-west-1:123456789:foundation-model/anthropic.claude-3-sonnet",
			"eu-west-1",
		},
		{
			"us-west-2 region",
			"arn:aws:bedrock:us-west-2:987654321:application-inference-profile/xyz123",
			"us-west-2",
		},
		{
			"ap-southeast-1 region",
			"arn:aws:bedrock:ap-southeast-1:111222333:application-inference-profile/abc",
			"ap-southeast-1",
		},
		{
			"not an ARN - standard model ID",
			"anthropic.claude-3-sonnet-20240229-v1:0",
			"",
		},
		{
			"not an ARN - claude model ID",
			"claude-sonnet-4-6",
			"",
		},
		{
			"empty string",
			"",
			"",
		},
		{
			"partial ARN - too few parts",
			"arn:aws:bedrock",
			"",
		},
		{
			"arn prefix but not bedrock",
			"arn:aws:s3:us-east-1:123456:bucket/my-bucket",
			"us-east-1",
		},
		{
			"arn with empty region",
			"arn:aws:bedrock::123456:application-inference-profile/abc",
			"",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, ExtractRegionFromARN(tt.arn))
		})
	}
}

// ---------------------------------------------------------------------------
// BedRockClient.Name tests
// ---------------------------------------------------------------------------

func TestBedRockClient_Name(t *testing.T) {
	c := &BedRockClient{}
	assert.Equal(t, "bedrock", c.Name())
}

// ---------------------------------------------------------------------------
// isCredentialExpiredError tests
// ---------------------------------------------------------------------------

func TestIsCredentialExpiredError(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{"nil error", nil, false},
		{"generic error", errors.New("something went wrong"), false},
		{"network error", errors.New("connection refused"), false},
		{"expired token message", errors.New("ExpiredToken: token has expired"), true},
		{"expired keyword", errors.New("the token has expired"), true},
		{"security token message", errors.New("the security token is invalid"), true},
		{"unauthorized access", errors.New("UnauthorizedAccess: forbidden"), true},
		{"access denied exception", &types.AccessDeniedException{Message: strPtr("access denied")}, true},
		{"wrapped expired error", fmt.Errorf("Bedrock Converse API: %w", errors.New("ExpiredToken: session expired")), true},
		{"wrapped access denied", fmt.Errorf("outer: %w", &types.AccessDeniedException{Message: strPtr("denied")}), true},
		{"case sensitive - not matched", errors.New("EXPIREDTOKEN"), false},
		{"context deadline exceeded", context.DeadlineExceeded, false},
		{"context canceled", context.Canceled, false},
		{"wrapped context deadline exceeded", fmt.Errorf("Bedrock Converse API: %w", context.DeadlineExceeded), false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, isCredentialExpiredError(tt.err))
		})
	}
}

func strPtr(s string) *string { return &s }

// ---------------------------------------------------------------------------
// BedRockClient model selection tests
// ---------------------------------------------------------------------------

func TestBedRockClient_ModelSelection(t *testing.T) {
	// Test that doConverse returns an error when no model is configured
	t.Run("no model ID returns error", func(t *testing.T) {
		c := &BedRockClient{}
		_, err := c.doConverse(context.Background(), "system", "user msg", 100, false)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "no Bedrock model ID configured")
	})

	t.Run("light model fallback to main when empty", func(t *testing.T) {
		// When lightModelID is empty and useLightModel is true,
		// it should fall back to the main modelID.
		// We can't test the full API call without a real client, but we verify
		// the model selection logic doesn't error when lightModelID is empty.
		c := &BedRockClient{
			modelID:      "arn:aws:bedrock:us-east-1:123:application-inference-profile/sonnet",
			lightModelID: "", // empty — should fall back to modelID
		}
		// This will fail because client is nil, but the error should NOT be about model ID
		_, err := c.doConverse(context.Background(), "system", "user msg", 100, true)
		require.Error(t, err)
		assert.NotContains(t, err.Error(), "no Bedrock model ID configured")
	})
}

// ---------------------------------------------------------------------------
// BedRockClient constructor tests
// ---------------------------------------------------------------------------

func TestNewBedRockClient_StoresFields(t *testing.T) {
	// NewBedRockClient will try to load AWS config. In CI/test environments without
	// AWS credentials, it should still succeed (lazy credential resolution).
	ctx := context.Background()
	client, err := NewBedRockClient(ctx, "", "us-east-1",
		"arn:aws:bedrock:us-east-1:123:application-inference-profile/sonnet",
		"arn:aws:bedrock:us-east-1:123:application-inference-profile/haiku",
		"aws sso login --profile test")

	require.NoError(t, err)
	require.NotNil(t, client)
	assert.Equal(t, "arn:aws:bedrock:us-east-1:123:application-inference-profile/sonnet", client.modelID)
	assert.Equal(t, "arn:aws:bedrock:us-east-1:123:application-inference-profile/haiku", client.lightModelID)
	assert.Equal(t, "us-east-1", client.region)
	assert.Equal(t, "aws sso login --profile test", client.authRefreshCmd)
	assert.NotNil(t, client.client) // bedrockruntime client created
}

func TestNewBedRockClient_EmptyProfileAndRegion(t *testing.T) {
	ctx := context.Background()
	client, err := NewBedRockClient(ctx, "", "", "model-id", "", "")
	require.NoError(t, err)
	require.NotNil(t, client)
	assert.Equal(t, "model-id", client.modelID)
	assert.Empty(t, client.lightModelID)
	assert.Empty(t, client.authRefreshCmd)
}

// ---------------------------------------------------------------------------
// BedRockClient.runAuthRefresh tests
// ---------------------------------------------------------------------------

func TestBedRockClient_RunAuthRefresh_EmptyCommand(t *testing.T) {
	c := &BedRockClient{authRefreshCmd: ""}
	// Empty parts → error
	err := c.runAuthRefresh(context.Background())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "empty auth refresh command")
}

func TestBedRockClient_RunAuthRefresh_SuccessfulCommand(t *testing.T) {
	c := &BedRockClient{authRefreshCmd: "echo hello"}
	err := c.runAuthRefresh(context.Background())
	assert.NoError(t, err)
}

func TestBedRockClient_RunAuthRefresh_FailingCommand(t *testing.T) {
	c := &BedRockClient{authRefreshCmd: "false"} // `false` exits with code 1
	err := c.runAuthRefresh(context.Background())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "running")
}

func TestBedRockClient_RunAuthRefresh_CancelledContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	c := &BedRockClient{authRefreshCmd: "sleep 60"}
	err := c.runAuthRefresh(ctx)
	assert.Error(t, err)
}

// ---------------------------------------------------------------------------
// BedRockClient converse retry logic tests
// ---------------------------------------------------------------------------

func TestBedRockClient_Converse_NoRetryOnNonCredentialError(t *testing.T) {
	// When the error is not a credential error, converse should NOT attempt refresh
	c := &BedRockClient{
		modelID:        "model-id",
		authRefreshCmd: "echo should-not-run",
	}
	// client is nil → will panic-ish or error, but that's the non-credential error
	_, err := c.converse(context.Background(), "system", "msg", 100, false)
	assert.Error(t, err)
	// The error should be about nil client / runtime panic, not about credential refresh
	assert.NotContains(t, err.Error(), "credential refresh")
}

// ---------------------------------------------------------------------------
// BedRockClient Provider interface compliance
// ---------------------------------------------------------------------------

// Compile-time interface check is in bedrock.go: var _ Provider = (*BedRockClient)(nil)
// This test verifies all methods exist and have correct signatures.
func TestBedRockClient_ImplementsProvider(t *testing.T) {
	var p Provider = &BedRockClient{}
	assert.NotNil(t, p)
	assert.Equal(t, "bedrock", p.Name())
}

// ---------------------------------------------------------------------------
// BedRockClient.reloadCredentials tests
// ---------------------------------------------------------------------------

func TestBedRockClient_ReloadCredentials(t *testing.T) {
	ctx := context.Background()
	c := &BedRockClient{
		region:  "us-east-1",
		profile: "",
	}

	// First set client to nil
	c.client = nil

	// Reload should create a new client
	err := c.reloadCredentials(ctx)
	require.NoError(t, err)
	assert.NotNil(t, c.client)
}

// ---------------------------------------------------------------------------
// BedRockClient message building tests (via public API calls that will error
// at the API call level, but exercise the message construction code paths)
// ---------------------------------------------------------------------------

func TestBedRockClient_GeneratePRDescription_MessageBuilding(t *testing.T) {
	// Client with nil bedrockruntime client — we're testing message construction
	// up to the point of the API call
	c := &BedRockClient{
		modelID: "test-model",
	}

	_, err := c.GeneratePRDescription(context.Background(), GeneratePRRequest{
		Commits: []CommitInfo{
			{SHA: "abc1234567890", Message: "Add login", Author: "dev", Files: 3},
			{SHA: "def456", Message: "Fix tests", Author: "dev", Files: 1},
		},
		DiffSummary:  "4 files changed",
		BranchName:   "feature/auth",
		BaseBranch:   "main",
		CustomPrompt: "Include ticket PROJ-123",
	})
	// Will error because client is nil, but shouldn't panic
	assert.Error(t, err)
}

func TestBedRockClient_GenerateSessionTitle_InputTruncation(t *testing.T) {
	c := &BedRockClient{
		modelID:      "test-model",
		lightModelID: "test-light-model",
	}

	// Very long input should be truncated without panicking
	longInput := strings.Repeat("a", 10000)
	_, err := c.GenerateSessionTitle(context.Background(), longInput)
	assert.Error(t, err) // API error, but no panic
}

func TestBedRockClient_GenerateConversationSummary_MessageTruncation(t *testing.T) {
	c := &BedRockClient{
		modelID: "test-model",
	}

	// Build messages exceeding maxInputChars
	bigContent := strings.Repeat("x", 10000)
	messages := make([]SummaryMessage, 50)
	for i := range messages {
		role := "user"
		if i%2 == 1 {
			role = "assistant"
		}
		messages[i] = SummaryMessage{Role: role, Content: bigContent}
	}

	_, err := c.GenerateConversationSummary(context.Background(), GenerateSummaryRequest{
		ConversationName: "Large Conv",
		Messages:         messages,
	})
	// Will error due to nil client, but shouldn't panic during truncation
	assert.Error(t, err)
}

func TestBedRockClient_GenerateSessionSummary_MultiConversation(t *testing.T) {
	c := &BedRockClient{
		modelID: "test-model",
	}

	_, err := c.GenerateSessionSummary(context.Background(), GenerateSessionSummaryRequest{
		SessionName: "Multi-conv Session",
		Task:        "Build feature",
		Conversations: []ConversationMessages{
			{
				Name: "Implementation",
				Type: "task",
				Messages: []SummaryMessage{
					{Role: "user", Content: "Build the feature"},
					{Role: "assistant", Content: "Working on it"},
				},
			},
			{
				Name: "Review",
				Type: "review",
				Messages: []SummaryMessage{
					{Role: "user", Content: "Review the changes"},
				},
			},
		},
	})
	assert.Error(t, err) // API error, but shouldn't panic
}

func TestBedRockClient_GenerateSessionSummary_LargeMessageTruncation(t *testing.T) {
	c := &BedRockClient{
		modelID: "test-model",
	}

	// Single message exceeding maxMessageChars should be truncated
	hugeContent := strings.Repeat("x", maxMessageChars+1000)
	_, err := c.GenerateSessionSummary(context.Background(), GenerateSessionSummaryRequest{
		SessionName: "Test",
		Conversations: []ConversationMessages{
			{
				Name: "Conv",
				Type: "task",
				Messages: []SummaryMessage{
					{Role: "user", Content: hugeContent},
					{Role: "assistant", Content: "Short reply"},
				},
			},
		},
	})
	assert.Error(t, err) // API error, but no panic from truncation
}

func TestBedRockClient_GenerateInputSuggestion_WithAllFields(t *testing.T) {
	c := &BedRockClient{
		modelID:      "test-model",
		lightModelID: "test-light",
	}

	falseVal := false
	trueVal := true

	_, err := c.GenerateInputSuggestion(context.Background(), SuggestionRequest{
		AgentText:      "I've finished implementing the feature.",
		SessionContext: "Phase: development\nConv: task",
		ToolActions: []SuggestionToolAction{
			{Tool: "Edit", Summary: "Modified auth.go", Success: &trueVal},
			{Tool: "Bash", Summary: "npm test failed", Success: &falseVal},
			{Tool: "Read"},
		},
	})
	assert.Error(t, err) // API error, but shouldn't panic
}

func TestBedRockClient_GenerateInputSuggestion_LargeAgentText(t *testing.T) {
	c := &BedRockClient{
		modelID:      "test-model",
		lightModelID: "test-light",
	}

	// Agent text exceeding suggestionMaxInputChars should be truncated
	largeText := strings.Repeat("x", suggestionMaxInputChars+500)
	_, err := c.GenerateInputSuggestion(context.Background(), SuggestionRequest{
		AgentText: largeText,
	})
	assert.Error(t, err) // API error, but no panic
}

// ---------------------------------------------------------------------------
// createBedrockClient tests
// ---------------------------------------------------------------------------

func TestCreateBedrockClient_DefaultConfig(t *testing.T) {
	client, err := createBedrockClient(context.Background(), "", "us-east-1")
	require.NoError(t, err)
	assert.NotNil(t, client)
}

func TestCreateBedrockClient_WithProfile(t *testing.T) {
	// Non-existent profile fails at config load time because AWS SDK
	// validates the profile exists in shared config immediately.
	_, err := createBedrockClient(context.Background(), "non-existent-profile", "us-west-2")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "non-existent-profile")
}

func TestCreateBedrockClient_NoRegion(t *testing.T) {
	client, err := createBedrockClient(context.Background(), "", "")
	require.NoError(t, err)
	assert.NotNil(t, client)
}
