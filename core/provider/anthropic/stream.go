package anthropic

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"strings"
	"time"

	"github.com/chatml/chatml-core/provider"
)

const (
	// streamIdleTimeout is the maximum time to wait between SSE events before
	// declaring the stream stalled. Matches Claude Code's STREAM_IDLE_TIMEOUT_MS (90s).
	streamIdleTimeout = 90 * time.Second
)

// Anthropic SSE event types from the Messages API streaming format.
// See: https://docs.anthropic.com/en/api/messages-streaming
const (
	sseMessageStart      = "message_start"
	sseContentBlockStart = "content_block_start"
	sseContentBlockDelta = "content_block_delta"
	sseContentBlockStop  = "content_block_stop"
	sseMessageDelta      = "message_delta"
	sseMessageStop       = "message_stop"
	ssePing              = "ping"
	sseError             = "error"
)

// processStream reads the SSE stream from the Anthropic API response body,
// parses each event, and emits unified provider.StreamEvent values on ch.
// It always closes both ch and body when done.
func (c *Client) processStream(ctx context.Context, body io.ReadCloser, ch chan<- provider.StreamEvent) {
	defer close(ch)
	defer body.Close()

	scanner := bufio.NewScanner(body)
	// SSE events can have large data payloads (tool inputs)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	// Read lines in a goroutine so we can apply an idle watchdog timer.
	// The goroutine checks ctx.Done to avoid leaking when the parent cancels
	// while the channel is full.
	type scanResult struct {
		line string
		ok   bool
	}
	lines := make(chan scanResult, 1)
	go func() {
		defer close(lines)
		for scanner.Scan() {
			select {
			case lines <- scanResult{line: scanner.Text(), ok: true}:
			case <-ctx.Done():
				return
			}
		}
	}()

	var eventType string
	var dataAccumulator strings.Builder // Accumulate multi-line data: fields per SSE spec
	// Track current tool block for accumulating input deltas
	var currentToolID string
	var currentToolName string
	var currentBlockType string // Track type of current content block
	var inputAccumulator strings.Builder

	idleTimer := time.NewTimer(streamIdleTimeout)
	defer idleTimer.Stop()

	for {
		// Select on line arrival, idle timeout, or context cancellation
		var line string
		select {
		case sr, open := <-lines:
			if !open {
				return // Stream finished normally
			}
			line = sr.line
			// Reset idle timer on each line received
			if !idleTimer.Stop() {
				select {
				case <-idleTimer.C:
				default:
				}
			}
			idleTimer.Reset(streamIdleTimeout)

		case <-idleTimer.C:
			ch <- provider.StreamEvent{
				Type:  provider.EventError,
				Error: fmt.Errorf("stream idle timeout: no data received for %s", streamIdleTimeout),
			}
			return

		case <-ctx.Done():
			ch <- provider.StreamEvent{Type: provider.EventError, Error: ctx.Err()}
			return
		}

		// SSE format: "event: <type>" followed by "data: <json>"
		if strings.HasPrefix(line, "event: ") {
			eventType = strings.TrimPrefix(line, "event: ")
			continue
		}

		if !strings.HasPrefix(line, "data: ") {
			// Empty line signals end of an event in the SSE spec.
			// If we have accumulated data, dispatch it now.
			if line == "" && dataAccumulator.Len() > 0 {
				// Process accumulated data (handled below after switch)
				// No-op here — we dispatch on the next event: or data: line
			}
			continue // Skip empty lines and comments
		}

		// Accumulate multi-line data fields (SSE spec allows multiple data: lines).
		// For single-line events (the common case), this just stores one line.
		// NOTE: In practice, Anthropic always sends single-line JSON data events,
		// so the multi-line accumulation path is effectively dead code. It is kept
		// for SSE spec compliance in case the server behavior changes.
		if dataAccumulator.Len() > 0 {
			dataAccumulator.WriteString("\n")
		}
		dataAccumulator.WriteString(strings.TrimPrefix(line, "data: "))

		// Peek ahead: if the NEXT line is also data:, we need to accumulate more.
		// Since we can't peek in a channel, we dispatch immediately (Anthropic sends
		// single-line JSON) and handle multi-line via accumulation if needed.
		data := dataAccumulator.String()
		dataAccumulator.Reset()

		switch eventType {
		case ssePing:
			// Ignore keepalive pings

		case sseMessageStart:
			var msg struct {
				Message struct {
					Usage *provider.Usage `json:"usage"`
				} `json:"message"`
			}
			if err := json.Unmarshal([]byte(data), &msg); err == nil {
				ch <- provider.StreamEvent{
					Type:  provider.EventMessageStart,
					Usage: msg.Message.Usage,
				}
			}

		case sseContentBlockStart:
			var block struct {
				Index        int `json:"index"`
				ContentBlock json.RawMessage `json:"content_block"`
			}
			if err := json.Unmarshal([]byte(data), &block); err != nil {
				continue
			}

			var blockHeader struct {
				Type      string `json:"type"`
				ID        string `json:"id,omitempty"`
				Name      string `json:"name,omitempty"`
				ToolUseID string `json:"tool_use_id,omitempty"`
			}
			if err := json.Unmarshal(block.ContentBlock, &blockHeader); err != nil {
				continue
			}
			currentBlockType = blockHeader.Type

			switch blockHeader.Type {
			case "tool_use":
				currentToolID = blockHeader.ID
				currentToolName = blockHeader.Name
				inputAccumulator.Reset()
				ch <- provider.StreamEvent{
					Type: provider.EventToolUseStart,
					ToolUse: &provider.ToolUseBlock{
						ID:   currentToolID,
						Name: currentToolName,
					},
				}

			case "server_tool_use":
				// Server-initiated tool execution (web search)
				ch <- provider.StreamEvent{
					Type:            provider.EventServerToolUseStart,
					ServerToolUseID: blockHeader.ID,
					ServerToolName:  blockHeader.Name,
				}

			case "web_search_tool_result":
				// Parse search results from the full content block
				var resultBlock struct {
					ToolUseID string          `json:"tool_use_id"`
					Content   json.RawMessage `json:"content"`
				}
				if err := json.Unmarshal(block.ContentBlock, &resultBlock); err != nil {
					log.Printf("anthropic: failed to parse web_search_tool_result: %v", err)
				}

				var hits []provider.WebSearchHit
				var errMsg string

				// Content can be an array of results or a single error object
				if len(resultBlock.Content) > 0 {
					// Try as array first (success case)
					var contentArray []struct {
						Type  string `json:"type"`
						URL   string `json:"url,omitempty"`
						Title string `json:"title,omitempty"`
						ErrorCode string `json:"error_code,omitempty"`
					}
					if json.Unmarshal(resultBlock.Content, &contentArray) == nil {
						for _, item := range contentArray {
							if item.Type == "web_search_result" {
								hits = append(hits, provider.WebSearchHit{
									Title: item.Title,
									URL:   item.URL,
								})
							}
						}
					} else {
						// Try as single error object
						var errObj struct {
							Type      string `json:"type"`
							ErrorCode string `json:"error_code"`
						}
						if json.Unmarshal(resultBlock.Content, &errObj) == nil && errObj.Type == "web_search_result_error" {
							errMsg = errObj.ErrorCode
						}
					}
				}

				ch <- provider.StreamEvent{
					Type:             provider.EventWebSearchResult,
					ServerToolUseID:  blockHeader.ToolUseID,
					WebSearchResults: hits,
					WebSearchError:   errMsg,
				}

			// text and thinking blocks start implicitly with deltas
			}

		case sseContentBlockDelta:
			var delta struct {
				Delta struct {
					Type     string `json:"type"`
					Text     string `json:"text,omitempty"`
					Thinking string `json:"thinking,omitempty"`
					PartialJSON string `json:"partial_json,omitempty"`
				} `json:"delta"`
			}
			if err := json.Unmarshal([]byte(data), &delta); err != nil {
				continue
			}

			switch delta.Delta.Type {
			case "text_delta":
				ch <- provider.StreamEvent{
					Type: provider.EventTextDelta,
					Text: delta.Delta.Text,
				}
			case "thinking_delta":
				ch <- provider.StreamEvent{
					Type:     provider.EventThinkingDelta,
					Thinking: delta.Delta.Thinking,
				}
			case "input_json_delta":
				if currentBlockType == "server_tool_use" {
					// Server-managed tool — accumulate but don't emit input delta events
					// (the server handles execution)
					break
				}
				inputAccumulator.WriteString(delta.Delta.PartialJSON)
				ch <- provider.StreamEvent{
					Type:       provider.EventToolUseInputDelta,
					InputDelta: delta.Delta.PartialJSON,
				}
			}

		case sseContentBlockStop:
			// If we were accumulating tool input, emit the complete tool block
			// (skip for server_tool_use — those are pre-executed by the server)
			if currentToolID != "" && currentBlockType != "server_tool_use" {
				inputJSON := inputAccumulator.String()
				if inputJSON == "" {
					inputJSON = "{}"
				}
				ch <- provider.StreamEvent{
					Type: provider.EventToolUseEnd,
					ToolUse: &provider.ToolUseBlock{
						ID:    currentToolID,
						Name:  currentToolName,
						Input: json.RawMessage(inputJSON),
					},
				}
				currentToolID = ""
				currentToolName = ""
				inputAccumulator.Reset()
			}
			currentBlockType = ""
			ch <- provider.StreamEvent{Type: provider.EventContentBlockStop}

		case sseMessageDelta:
			var delta struct {
				Delta struct {
					StopReason string `json:"stop_reason,omitempty"`
				} `json:"delta"`
				Usage *provider.Usage `json:"usage,omitempty"`
			}
			if err := json.Unmarshal([]byte(data), &delta); err == nil {
				ch <- provider.StreamEvent{
					Type:       provider.EventMessageDelta,
					StopReason: delta.Delta.StopReason,
					Usage:      delta.Usage,
				}
			}

		case sseMessageStop:
			ch <- provider.StreamEvent{Type: provider.EventMessageStop}

		case sseError:
			var errResp struct {
				Error struct {
					Type    string `json:"type"`
					Message string `json:"message"`
				} `json:"error"`
			}
			if err := json.Unmarshal([]byte(data), &errResp); err == nil {
				ch <- provider.StreamEvent{
					Type:  provider.EventError,
					Error: &APIError{Type: errResp.Error.Type, Message: errResp.Error.Message},
				}
			}
		}

		eventType = "" // Reset for next event
	}
}

// APIError represents an error from the Anthropic API.
type APIError struct {
	Type    string `json:"type"`
	Message string `json:"message"`
}

func (e *APIError) Error() string {
	return "anthropic: " + e.Type + ": " + e.Message
}
