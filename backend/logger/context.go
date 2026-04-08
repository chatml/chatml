package logger

import (
	"context"
	"fmt"

	"github.com/charmbracelet/log"
)

type contextKey string

const (
	sessionIDKey      contextKey = "session_id"
	conversationIDKey contextKey = "conversation_id"
)

// WithSessionID adds a session ID to the context for structured logging.
func WithSessionID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, sessionIDKey, id)
}

// WithConversationID adds a conversation ID to the context for structured logging.
func WithConversationID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, conversationIDKey, id)
}

// FromContext returns a logger with session/conversation IDs from the context.
// Falls back to the given base logger if no IDs are present.
func FromContext(ctx context.Context, base *log.Logger) *log.Logger {
	prefix := ""
	if sid, ok := ctx.Value(sessionIDKey).(string); ok && sid != "" {
		prefix = fmt.Sprintf("[sess:%s]", sid)
	}
	if cid, ok := ctx.Value(conversationIDKey).(string); ok && cid != "" {
		if prefix != "" {
			prefix += " "
		}
		prefix += fmt.Sprintf("[conv:%s]", cid)
	}
	if prefix == "" {
		return base
	}
	return base.WithPrefix(prefix)
}
