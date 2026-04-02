package builtin

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/chatml/chatml-backend/tool"
)

const (
	webFetchTimeout      = 60 * time.Second    // Matches Claude Code's FETCH_TIMEOUT_MS
	webFetchMaxBytes     = 10 * 1024 * 1024    // 10MB max response (matches Claude Code)
	webFetchMaxOutput    = 100_000             // Truncate text output to 100K chars
	webFetchMaxRedirects = 10                  // Matches Claude Code
)

const webFetchCacheTTL = 15 * time.Minute // Matches Claude Code's cache TTL

type cachedResponse struct {
	content   string
	metadata  map[string]interface{}
	fetchedAt time.Time
}

// WebFetchTool fetches content from URLs with a 15-minute response cache.
type WebFetchTool struct {
	mu    sync.RWMutex
	cache map[string]*cachedResponse
}

func NewWebFetchTool() *WebFetchTool {
	return &WebFetchTool{
		cache: make(map[string]*cachedResponse),
	}
}

func (t *WebFetchTool) Name() string { return "WebFetch" }

func (t *WebFetchTool) Description() string {
	return `Fetches content from a URL. Returns the text content of the page. For HTML pages, tags are stripped and main content is extracted.`
}

func (t *WebFetchTool) InputSchema() json.RawMessage {
	return json.RawMessage(`{
		"type": "object",
		"properties": {
			"url": {
				"type": "string",
				"description": "The URL to fetch"
			}
		},
		"required": ["url"]
	}`)
}

func (t *WebFetchTool) IsConcurrentSafe() bool { return true }

type webFetchInput struct {
	URL string `json:"url"`
}

func (t *WebFetchTool) Execute(ctx context.Context, input json.RawMessage) (*tool.Result, error) {
	var in webFetchInput
	if err := json.Unmarshal(input, &in); err != nil {
		return tool.ErrorResult(fmt.Sprintf("Invalid input: %v", err)), nil
	}

	if in.URL == "" {
		return tool.ErrorResult("url is required"), nil
	}

	// Check cache first
	t.mu.RLock()
	if cached, ok := t.cache[in.URL]; ok && time.Since(cached.fetchedAt) < webFetchCacheTTL {
		t.mu.RUnlock()
		return &tool.Result{
			Content:  cached.content,
			Metadata: cached.metadata,
		}, nil
	}
	t.mu.RUnlock()

	// Validate URL scheme
	if !strings.HasPrefix(in.URL, "http://") && !strings.HasPrefix(in.URL, "https://") {
		return tool.ErrorResult("URL must start with http:// or https://"), nil
	}

	client := &http.Client{
		Timeout: webFetchTimeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= webFetchMaxRedirects {
				return fmt.Errorf("too many redirects (max %d)", webFetchMaxRedirects)
			}
			return nil
		},
	}

	req, err := http.NewRequestWithContext(ctx, "GET", in.URL, nil)
	if err != nil {
		return tool.ErrorResult(fmt.Sprintf("Invalid URL: %v", err)), nil
	}
	req.Header.Set("User-Agent", "ChatML/1.0 (WebFetch Tool)")
	req.Header.Set("Accept", "text/html, text/plain, application/json, */*")

	resp, err := client.Do(req)
	if err != nil {
		return tool.ErrorResult(fmt.Sprintf("Fetch failed: %v", err)), nil
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return tool.ErrorResult(fmt.Sprintf("HTTP %d: %s", resp.StatusCode, resp.Status)), nil
	}

	// Read limited body
	body, err := io.ReadAll(io.LimitReader(resp.Body, webFetchMaxBytes))
	if err != nil {
		return tool.ErrorResult(fmt.Sprintf("Read error: %v", err)), nil
	}

	content := string(body)
	contentType := resp.Header.Get("Content-Type")

	// Strip HTML if content is HTML
	if strings.Contains(contentType, "text/html") {
		content = stripHTML(content)
	}

	// Truncate text output to prevent context window bloat
	if len(content) > webFetchMaxOutput {
		content = content[:webFetchMaxOutput] + "\n... (content truncated)"
	}

	metadata := map[string]interface{}{
		"url":         in.URL,
		"statusCode":  resp.StatusCode,
		"contentType": contentType,
	}

	// Store in cache
	t.mu.Lock()
	t.cache[in.URL] = &cachedResponse{
		content:   content,
		metadata:  metadata,
		fetchedAt: time.Now(),
	}
	t.mu.Unlock()

	return &tool.Result{
		Content:  content,
		Metadata: metadata,
	}, nil
}

// htmlTagRe matches HTML tags.
var htmlTagRe = regexp.MustCompile(`<[^>]*>`)

// whitespaceRe matches multiple consecutive whitespace/newlines.
var whitespaceRe = regexp.MustCompile(`\s{3,}`)

// stripHTML removes HTML tags and collapses whitespace.
func stripHTML(html string) string {
	// Remove script and style blocks
	html = regexp.MustCompile(`(?is)<script[^>]*>.*?</script>`).ReplaceAllString(html, "")
	html = regexp.MustCompile(`(?is)<style[^>]*>.*?</style>`).ReplaceAllString(html, "")

	// Remove tags
	text := htmlTagRe.ReplaceAllString(html, " ")

	// Collapse whitespace
	text = whitespaceRe.ReplaceAllString(text, "\n\n")

	return strings.TrimSpace(text)
}

var _ tool.Tool = (*WebFetchTool)(nil)
