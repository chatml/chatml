package builtin

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/chatml/chatml-core/tool"
)

// Note: Claude Code waits INDEFINITELY for user responses (no timeout).
// We match this — cancellation only via context (runner stop/interrupt).

// UserQuestionCallback is the interface tools use to ask the user questions.
type UserQuestionCallback interface {
	// EmitQuestionRequest sends a user_question_request event and returns
	// a channel that will receive the user's answers.
	EmitQuestionRequest(requestID string, questions []QuestionDef) <-chan map[string]string
}

// QuestionOption defines a selectable option for a question.
type QuestionOption struct {
	Label       string `json:"label"`
	Description string `json:"description,omitempty"`
}

// QuestionDef defines a single question to ask the user.
type QuestionDef struct {
	ID          string           `json:"id"`
	Text        string           `json:"text"`
	Placeholder string           `json:"placeholder,omitempty"`
	Options     []QuestionOption `json:"options,omitempty"`
	MultiSelect bool             `json:"multiSelect,omitempty"`
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
						"placeholder": { "type": "string", "description": "Placeholder text for the input field" },
						"options": {
							"type": "array",
							"description": "Predefined options for the user to choose from. If you recommend a specific option, make it the first in the list and add (Recommended) to the label.",
							"items": {
								"type": "object",
								"properties": {
									"label": { "type": "string", "description": "Option display text" },
									"description": { "type": "string", "description": "Optional description of this option" }
								},
								"required": ["label"]
							}
						},
						"multiSelect": { "type": "boolean", "description": "Allow selecting multiple options (default: false)" }
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

// Prompt implements tool.PromptProvider.
func (t *AskUserQuestionTool) Prompt() string {
	return `Use this tool when you need to ask the user questions during execution. This allows you to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take.

Usage notes:
- Users will always be able to select "Other" to provide custom text input
- Use multiSelect: true to allow multiple answers to be selected for a question
- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label

Plan mode note: In plan mode, use this tool to clarify requirements or choose between approaches BEFORE finalizing your plan. Do NOT use this tool to ask "Is my plan ready?" or "Should I proceed?" - use ExitPlanModeTool for plan approval. IMPORTANT: Do not reference "the plan" in your questions because the user cannot see the plan in the UI until you call ExitPlanModeTool.`
}

var _ tool.Tool = (*AskUserQuestionTool)(nil)
var _ tool.PromptProvider = (*AskUserQuestionTool)(nil)
