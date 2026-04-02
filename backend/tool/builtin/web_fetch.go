package builtin

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
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

const (
	webFetchCacheTTL     = 15 * time.Minute // Matches Claude Code's cache TTL
	webFetchMaxCacheSize = 100              // Evict stale entries when cache exceeds this size
)

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
			},
			"prompt": {
				"type": "string",
				"description": "Optional prompt describing what information to extract from the page"
			}
		},
		"required": ["url"]
	}`)
}

func (t *WebFetchTool) IsConcurrentSafe() bool { return true }

type webFetchInput struct {
	URL    string `json:"url"`
	Prompt string `json:"prompt"`
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

	// Upgrade HTTP to HTTPS
	fetchURL := in.URL
	if strings.HasPrefix(fetchURL, "http://") {
		fetchURL = "https://" + strings.TrimPrefix(fetchURL, "http://")
	}

	// Validate URL scheme
	if !strings.HasPrefix(fetchURL, "https://") {
		return tool.ErrorResult("URL must start with http:// or https://"), nil
	}

	// Block requests to private/loopback addresses (SSRF protection).
	// Uses both a pre-flight DNS check and a DialContext guard to prevent
	// DNS rebinding attacks.
	if err := validateNotPrivateHost(fetchURL); err != nil {
		return tool.ErrorResult(err.Error()), nil
	}

	// Track redirects
	var finalURL string
	redirectCount := 0

	// Defence-in-depth: validate resolved IP at connection time to block
	// DNS rebinding (where pre-flight resolves to a public IP but the
	// actual connection resolves to a private one).
	safeDialer := &net.Dialer{Timeout: 10 * time.Second}
	safeTransport := &http.Transport{
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(addr)
			if err != nil {
				return nil, err
			}
			addrs, err := net.DefaultResolver.LookupHost(ctx, host)
			if err != nil {
				return nil, err
			}
			for _, resolved := range addrs {
				ip := net.ParseIP(resolved)
				if ip != nil && isPrivateIP(ip) {
					return nil, fmt.Errorf("blocked: %s resolves to private/loopback address %s", host, resolved)
				}
			}
			// Connect to the first allowed address
			return safeDialer.DialContext(ctx, network, net.JoinHostPort(addrs[0], port))
		},
	}

	client := &http.Client{
		Timeout:   webFetchTimeout,
		Transport: safeTransport,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= webFetchMaxRedirects {
				return fmt.Errorf("too many redirects (max %d)", webFetchMaxRedirects)
			}
			// Reject HTTPS→HTTP downgrade redirects. The initial URL is
			// upgraded to HTTPS; allowing a redirect back to HTTP would
			// expose headers on a plaintext connection.
			if req.URL.Scheme == "http" {
				return fmt.Errorf("redirect to plaintext HTTP rejected (HTTPS downgrade)")
			}
			redirectCount++
			finalURL = req.URL.String()
			return nil
		},
	}

	req, err := http.NewRequestWithContext(ctx, "GET", fetchURL, nil)
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

	// Prepend redirect info if URL changed
	if redirectCount > 0 && finalURL != "" && finalURL != fetchURL {
		content = fmt.Sprintf("[Redirected to: %s (%d redirect(s))]\n\n%s", finalURL, redirectCount, content)
	}

	metadata := map[string]interface{}{
		"url":           in.URL,
		"finalUrl":      finalURL,
		"statusCode":    resp.StatusCode,
		"contentType":   contentType,
		"redirectCount": redirectCount,
	}

	// Store in cache (with lazy eviction of stale entries)
	t.mu.Lock()
	t.cache[in.URL] = &cachedResponse{
		content:   content,
		metadata:  metadata,
		fetchedAt: time.Now(),
	}
	if len(t.cache) > webFetchMaxCacheSize {
		now := time.Now()
		for k, v := range t.cache {
			if now.Sub(v.fetchedAt) > webFetchCacheTTL {
				delete(t.cache, k)
			}
		}
	}
	t.mu.Unlock()

	return &tool.Result{
		Content:  content,
		Metadata: metadata,
	}, nil
}

// validateNotPrivateHost performs a pre-flight DNS resolution check to block
// requests to private, loopback, and link-local addresses.
func validateNotPrivateHost(rawURL string) error {
	u, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("invalid URL: %v", err)
	}
	host := u.Hostname()
	if host == "" {
		return fmt.Errorf("URL has no host")
	}

	// Check if host is a literal IP first
	if ip := net.ParseIP(host); ip != nil {
		if isPrivateIP(ip) {
			return fmt.Errorf("URL points to a private/loopback address — blocked for security")
		}
		return nil
	}

	// Resolve hostname and check all addresses
	addrs, err := net.LookupHost(host)
	if err != nil {
		return nil // Let the HTTP client surface the DNS error
	}
	for _, addr := range addrs {
		ip := net.ParseIP(addr)
		if ip != nil && isPrivateIP(ip) {
			return fmt.Errorf("URL resolves to a private/loopback address — blocked for security")
		}
	}
	return nil
}

// isPrivateIP returns true if the IP is loopback, private, link-local, or
// a well-known cloud metadata address (169.254.169.254).
func isPrivateIP(ip net.IP) bool {
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast()
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

// Prompt implements tool.PromptProvider.
func (t *WebFetchTool) Prompt() string {
	return `- Fetches content from a specified URL and processes it
- Takes a URL and an optional prompt as input
- Fetches the URL content, converts HTML to markdown
- Returns the processed content
- Use this tool when you need to retrieve and analyze web content

Usage notes:
  - The URL must be a fully-formed valid URL
  - HTTP URLs will be automatically upgraded to HTTPS
  - The prompt should describe what information you want to extract from the page
  - This tool is read-only and does not modify any files
  - Results may be summarized if the content is very large
  - Includes a self-cleaning 15-minute cache for faster responses when repeatedly accessing the same URL
  - When a URL redirects to a different host, the tool will inform you and provide the redirect URL in a special format. You should then make a new WebFetch request with the redirect URL to fetch the content.
  - For GitHub URLs, prefer using the gh CLI via Bash instead (e.g., gh pr view, gh issue view, gh api).`
}

var _ tool.Tool = (*WebFetchTool)(nil)
var _ tool.PromptProvider = (*WebFetchTool)(nil)
