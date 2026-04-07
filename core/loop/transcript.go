package loop

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/chatml/chatml-core/provider"
)

// TranscriptEntry is a single line in a JSONL transcript file.
type TranscriptEntry struct {
	Timestamp time.Time          `json:"timestamp"`
	SessionID string             `json:"session_id"`
	ParentID  string             `json:"parent_id,omitempty"` // Parent session for sub-agents
	Message   provider.Message   `json:"message"`
	Metadata  *TranscriptMeta    `json:"metadata,omitempty"` // First entry only
}

// TranscriptMeta holds session-level metadata stored with the first entry.
type TranscriptMeta struct {
	Model           string    `json:"model"`
	CreatedAt       time.Time `json:"created_at"`
	Title           string    `json:"title,omitempty"`
	Tags            []string  `json:"tags,omitempty"`
	CostUSD         float64   `json:"cost_usd,omitempty"`
	InputTokens     int       `json:"input_tokens,omitempty"`
	OutputTokens    int       `json:"output_tokens,omitempty"`
}

// TranscriptWriter appends messages to a JSONL transcript file.
// Thread-safe for concurrent writes from tool execution.
type TranscriptWriter struct {
	mu        sync.Mutex
	file      *os.File
	sessionID string
	parentID  string
	path      string
}

// NewTranscriptWriter creates a writer for the given session.
// The transcript file is stored at <dir>/<sessionID>.jsonl
func NewTranscriptWriter(dir, sessionID, parentID string) (*TranscriptWriter, error) {
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("create transcript dir: %w", err)
	}

	path := filepath.Join(dir, sessionID+".jsonl")
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		return nil, fmt.Errorf("open transcript file: %w", err)
	}

	return &TranscriptWriter{
		file:      f,
		sessionID: sessionID,
		parentID:  parentID,
		path:      path,
	}, nil
}

// WriteMessage appends a message to the transcript.
func (tw *TranscriptWriter) WriteMessage(msg provider.Message) error {
	tw.mu.Lock()
	defer tw.mu.Unlock()

	entry := TranscriptEntry{
		Timestamp: time.Now(),
		SessionID: tw.sessionID,
		ParentID:  tw.parentID,
		Message:   msg,
	}

	data, err := json.Marshal(entry)
	if err != nil {
		return fmt.Errorf("marshal transcript entry: %w", err)
	}

	line := string(data) + "\n"
	if _, err := tw.file.WriteString(line); err != nil {
		return fmt.Errorf("write transcript entry: %w", err)
	}

	return nil
}

// WriteMetadata writes session metadata as the first entry.
func (tw *TranscriptWriter) WriteMetadata(meta TranscriptMeta) error {
	tw.mu.Lock()
	defer tw.mu.Unlock()

	entry := TranscriptEntry{
		Timestamp: time.Now(),
		SessionID: tw.sessionID,
		ParentID:  tw.parentID,
		Metadata:  &meta,
	}

	data, err := json.Marshal(entry)
	if err != nil {
		return fmt.Errorf("marshal metadata entry: %w", err)
	}

	line := string(data) + "\n"
	if _, err := tw.file.WriteString(line); err != nil {
		return fmt.Errorf("write metadata entry: %w", err)
	}

	return nil
}

// Close flushes and closes the transcript file.
func (tw *TranscriptWriter) Close() error {
	tw.mu.Lock()
	defer tw.mu.Unlock()
	return tw.file.Close()
}

// Path returns the absolute path to the transcript file.
func (tw *TranscriptWriter) Path() string {
	return tw.path
}

// ---------------------------------------------------------------------------
// Reading / Resuming
// ---------------------------------------------------------------------------

// ReadTranscript loads all messages from a JSONL transcript file.
// Returns messages in order and the session metadata (if present).
func ReadTranscript(path string) ([]provider.Message, *TranscriptMeta, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, nil, fmt.Errorf("open transcript: %w", err)
	}
	defer f.Close()

	var messages []provider.Message
	var meta *TranscriptMeta

	scanner := bufio.NewScanner(f)
	// Increase buffer for large tool results
	scanner.Buffer(make([]byte, 0, 1<<20), 10<<20) // 10MB max line

	for scanner.Scan() {
		var entry TranscriptEntry
		if err := json.Unmarshal(scanner.Bytes(), &entry); err != nil {
			continue // Skip malformed entries
		}
		if entry.Metadata != nil && meta == nil {
			meta = entry.Metadata
		}
		// Only include entries that have actual message content
		if len(entry.Message.Content) > 0 {
			messages = append(messages, entry.Message)
		}
	}

	if err := scanner.Err(); err != nil {
		return messages, meta, fmt.Errorf("scan transcript: %w", err)
	}

	return messages, meta, nil
}

// FindTranscript locates the transcript file for a session ID.
// Searches in the standard transcript directory.
func FindTranscript(transcriptDir, sessionID string) string {
	path := filepath.Join(transcriptDir, sessionID+".jsonl")
	if _, err := os.Stat(path); err == nil {
		return path
	}
	return ""
}

// ListTranscripts returns all available session transcripts.
func ListTranscripts(transcriptDir string) ([]TranscriptSummary, error) {
	entries, err := os.ReadDir(transcriptDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}

	var summaries []TranscriptSummary
	for _, e := range entries {
		if e.IsDir() || filepath.Ext(e.Name()) != ".jsonl" {
			continue
		}

		path := filepath.Join(transcriptDir, e.Name())
		sessionID := e.Name()[:len(e.Name())-len(".jsonl")]

		info, _ := e.Info()
		summary := TranscriptSummary{
			SessionID: sessionID,
			Path:      path,
		}
		if info != nil {
			summary.ModTime = info.ModTime()
			summary.SizeBytes = info.Size()
		}

		// Read metadata from first line (quick peek)
		if f, err := os.Open(path); err == nil {
			scanner := bufio.NewScanner(f)
			if scanner.Scan() {
				var entry TranscriptEntry
				if json.Unmarshal(scanner.Bytes(), &entry) == nil && entry.Metadata != nil {
					summary.Model = entry.Metadata.Model
					summary.Title = entry.Metadata.Title
					summary.Tags = entry.Metadata.Tags
					summary.CreatedAt = entry.Metadata.CreatedAt
					summary.CostUSD = entry.Metadata.CostUSD
				}
			}
			f.Close()
		}

		summaries = append(summaries, summary)
	}

	return summaries, nil
}

// TranscriptSummary is a lightweight summary of a session transcript.
type TranscriptSummary struct {
	SessionID string    `json:"session_id"`
	Path      string    `json:"path"`
	ModTime   time.Time `json:"mod_time"`
	SizeBytes int64     `json:"size_bytes"`
	Model     string    `json:"model,omitempty"`
	Title     string    `json:"title,omitempty"`
	Tags      []string  `json:"tags,omitempty"`
	CreatedAt time.Time `json:"created_at,omitempty"`
	CostUSD   float64   `json:"cost_usd,omitempty"`
}

// TranscriptDir returns the standard transcript directory.
// Transcripts are stored in ~/.chatml/transcripts/ to avoid polluting projects.
func TranscriptDir(workdir string) string {
	home, err := os.UserHomeDir()
	if err != nil {
		// Fallback to workdir if home is unavailable
		return filepath.Join(workdir, ".chatml", "transcripts")
	}
	return filepath.Join(home, ".chatml", "transcripts")
}
