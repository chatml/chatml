package builtin

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/chatml/chatml-backend/tool"
)

const (
	webFetchTimeout      = 60 * time.Second    // Matches Claude Code's FETCH_TIMEOUT_MS
	webFetchMaxBytes     = 10 * 1024 * 1024    // 10MB max response (matches Claude Code)
	webFetchMaxOutput    = 100_000             // Truncate text output to 100K chars
	webFetchMaxRedirects = 10                  // Matches Claude Code
)

// WebFetchTool fetches content from URLs.
type WebFetchTool struct{}

func NewWebFetchTool() *WebFetchTool {
	return &WebFetchTool{}
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

	return &tool.Result{
		Content: content,
		Metadata: map[string]interface{}{
			"url":         in.URL,
			"statusCode":  resp.StatusCode,
			"contentType": contentType,
		},
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
