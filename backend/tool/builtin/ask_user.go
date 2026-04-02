package builtin

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/chatml/chatml-backend/tool"
)

// Note: Claude Code waits INDEFINITELY for user responses (no timeout).
// We match this — cancellation only via context (runner stop/interrupt).

// UserQuestionCallback is the interface tools use to ask the user questions.
type UserQuestionCallback interface {
	// EmitQuestionRequest sends a user_question_request event and returns
	// a channel that will receive the user's answers.
	EmitQuestionRequest(requestID string, questions []QuestionDef) <-chan map[string]string
}

// QuestionDef defines a single question to ask the user.
type QuestionDef struct {
	ID          string `json:"id"`
	Text        string `json:"text"`
	Placeholder string `json:"placeholder,omitempty"`
}

// AskUserQuestionTool asks the user structured questions and waits for responses.
type AskUserQuestionTool struct {
	callback UserQuestionCallback
}

// NewAskUserQuestionTool creates an AskUserQuestion tool with the given callback.
func NewAskUserQuestionTool(callback UserQuestionCallback) *AskUserQuestionTool {
	return &AskUserQuestionTool{callback: callback}
}

func (t *AskUserQuestionTool) Name() string { return "AskUserQuestion" }

func (t *AskUserQuestionTool) Description() string {
	return `Asks the user one or more questions and waits for their response. Use this when you need clarification or input from the user to proceed.`
}

func (t *AskUserQuestionTool) InputSchema() json.RawMessage {
	return json.RawMessage(`{
		"type": "object",
		"properties": {
			"questions": {
				"type": "array",
				"description": "Questions to ask the user",
				"items": {
					"type": "object",
					"properties": {
						"id": { "type": "string", "description": "Unique question identifier" },
						"text": { "type": "string", "description": "The question text" },
						"placeholder": { "type": "string", "description": "Placeholder text for the input field" }
					},
					"required": ["id", "text"]
				}
			}
		},
		"required": ["questions"]
	}`)
}

func (t *AskUserQuestionTool) IsConcurrentSafe() bool { return false }

type askUserInput struct {
	Questions []QuestionDef `json:"questions"`
}

func (t *AskUserQuestionTool) Execute(ctx context.Context, input json.RawMessage) (*tool.Result, error) {
	var in askUserInput
	if err := json.Unmarshal(input, &in); err != nil {
		return tool.ErrorResult(fmt.Sprintf("Invalid input: %v", err)), nil
	}

	if len(in.Questions) == 0 {
		return tool.ErrorResult("At least one question is required"), nil
	}

	if t.callback == nil {
		return tool.ErrorResult("AskUserQuestion is not available (no callback configured)"), nil
	}

	// Generate a request ID
	requestID := fmt.Sprintf("uq-%d", time.Now().UnixMilli())

	// Emit the question request and get the response channel
	respCh := t.callback.EmitQuestionRequest(requestID, in.Questions)

	// Block waiting for the user's response — no timeout (matches Claude Code).
	select {
	case answers := <-respCh:
		if answers == nil {
			return tool.ErrorResult("User did not respond to the questions"), nil
		}

		// Format answers as readable text
		var result []string
		for _, q := range in.Questions {
			answer, ok := answers[q.ID]
			if ok {
				result = append(result, fmt.Sprintf("%s: %s", q.Text, answer))
			}
		}
		return tool.TextResult(fmt.Sprintf("User responses:\n%s", joinLines(result))), nil

	case <-ctx.Done():
		return tool.ErrorResult("User question cancelled"), nil
	}
}

func joinLines(lines []string) string {
	result := ""
	for _, l := range lines {
		result += "- " + l + "\n"
	}
	return result
}

var _ tool.Tool = (*AskUserQuestionTool)(nil)
