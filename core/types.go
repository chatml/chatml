package core

// Attachment represents a file attached to a message.
type Attachment struct {
	ID         string `json:"id"`
	Type       string `json:"type"`
	Name       string `json:"name"`
	Path       string `json:"path,omitempty"`
	MimeType   string `json:"mimeType"`
	Size       int64  `json:"size"`
	LineCount  int    `json:"lineCount,omitempty"`
	Width      int    `json:"width,omitempty"`
	Height     int    `json:"height,omitempty"`
	Base64Data string `json:"base64Data,omitempty"`
	Preview    string `json:"preview,omitempty"`
}

// Message is a minimal message type for turn-tracking in the agentic loop.
// The full-featured Message (with RunSummary, ToolUsage, Timeline, etc.) lives
// in the backend models package; this stripped-down version carries only the
// fields that the core ConversationBackend interface needs.
type Message struct {
	ID      string `json:"id"`
	Role    string `json:"role"`
	Content string `json:"content"`
}
