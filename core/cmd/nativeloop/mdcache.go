package main

import (
	"hash/fnv"
	"strings"
	"sync"
	"time"

	"github.com/charmbracelet/glamour"
	"github.com/charmbracelet/lipgloss"
)

// ── Markdown LRU Cache ─────────────────────────────────────────────────────
//
// Caches rendered markdown output keyed by content hash + terminal width.
// Avoids re-rendering unchanged messages on every frame.
// Uses FIFO eviction (max 500 entries). Not true LRU — reads don't update access order.

const mdCacheMaxEntries = 500

type mdCache struct {
	mu        sync.RWMutex
	entries   map[uint64]string
	order     []uint64 // LRU eviction order (oldest first)
	renderer  *glamour.TermRenderer
	width     int
	themeName string
}

func newMDCache(width int, themeName string) *mdCache {
	// Error ignored: Render() handles nil renderer by falling back to raw content.
	r, _ := glamour.NewTermRenderer(
		glamour.WithStyles(glamourStyleForTheme(themeName)),
		glamour.WithWordWrap(clampWidth(width)),
	)
	return &mdCache{
		entries:   make(map[uint64]string, mdCacheMaxEntries),
		renderer:  r,
		width:     width,
		themeName: themeName,
	}
}

func clampWidth(w int) int {
	if w < 40 {
		return 40
	}
	if w > 120 {
		return 120
	}
	return w
}

// Render returns cached or freshly-rendered markdown.
func (c *mdCache) Render(content string) string {
	if content == "" {
		return ""
	}
	key := c.hash(content)

	c.mu.RLock()
	if cached, ok := c.entries[key]; ok {
		c.mu.RUnlock()
		return cached
	}
	c.mu.RUnlock()

	rendered := content
	if c.renderer != nil {
		out, err := c.renderer.Render(content)
		if err == nil {
			rendered = strings.TrimLeft(out, "\n \t")
			rendered = strings.TrimRight(rendered, "\n")
		}
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	if len(c.entries) >= mdCacheMaxEntries {
		if len(c.order) > 0 {
			oldest := c.order[0]
			c.order = c.order[1:]
			delete(c.entries, oldest)
		}
	}

	c.entries[key] = rendered
	c.order = append(c.order, key)
	return rendered
}

// RenderNoCache renders markdown without caching (for streaming content that changes every frame).
func (c *mdCache) RenderNoCache(content string) string {
	if content == "" {
		return ""
	}
	if c.renderer != nil {
		out, err := c.renderer.Render(content)
		if err == nil {
			rendered := strings.TrimLeft(out, "\n \t")
			return strings.TrimRight(rendered, "\n")
		}
	}
	return content
}

// SetTheme updates the glamour theme and invalidates the cache.
func (c *mdCache) SetTheme(themeName string, width int) {
	c.mu.Lock()
	c.themeName = themeName
	c.mu.Unlock()
	c.Invalidate(width)
}

// Invalidate clears the cache (e.g., on terminal resize).
func (c *mdCache) Invalidate(newWidth int) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.entries = make(map[uint64]string, mdCacheMaxEntries)
	c.order = c.order[:0]
	c.width = newWidth
	c.renderer, _ = glamour.NewTermRenderer(
		glamour.WithStyles(glamourStyleForTheme(c.themeName)),
		glamour.WithWordWrap(clampWidth(newWidth)),
	)
}

func (c *mdCache) hash(content string) uint64 {
	h := fnv.New64a()
	h.Write([]byte(content))
	w := byte(c.width & 0xFF)
	h.Write([]byte{w, byte(c.width >> 8 & 0xFF)})
	return h.Sum64()
}

// ── Per-message rendering ──────────────────────────────────────────────────

// renderSingleMessage renders one displayMessage to a string.
// Uses the mdCache for assistant markdown content.
func renderSingleMessage(msg *displayMessage, width int, s *styles, cache *mdCache, verbose bool) string {
	if (msg.kind == msgTool || msg.kind == msgToolRunning) && msg.tool == "TodoWrite" {
		return ""
	}

	var b strings.Builder

	switch msg.kind {
	case msgUser:
		b.WriteString(s.userMsg.Render("  ❯ "+msg.content) + "\n")

	case msgAssistant:
		var content string
		if msg.streaming {
			// Throttled streaming: re-render via glamour at most every 150ms
			if time.Since(msg.lastRenderTime) > 150*time.Millisecond || msg.lastRenderedMD == "" {
				content = cache.RenderNoCache(msg.content)
				msg.lastRenderedMD = content
				msg.lastRenderTime = time.Now()
			} else {
				content = msg.lastRenderedMD
			}
		} else {
			content = cache.Render(msg.content)
		}
		b.WriteString("● " + content + "\n")

	case msgTool:
		renderToolMessage(&b, s, msg, verbose)

	case msgToolRunning:
		renderToolRunningMessage(&b, s, msg)

	case msgThinking:
		renderThinkingMessage(&b, s, msg, verbose)

	case msgSystem:
		b.WriteString(s.gray.Render("  "+msg.content) + "\n")

	case msgError:
		b.WriteString(s.toolFail.Render("  ✗ Error: "+msg.content) + "\n")

	case msgApproval:
		renderApprovalMessage(&b, s, msg)

	case msgQuestion:
		renderQuestionMessage(&b, s, msg)

	case msgPlanReview:
		renderPlanReviewMessage(&b, s, msg, cache.renderer)

	case msgTurnSeparator:
		renderTurnSeparator(&b, s, msg, width)
	}

	return b.String()
}

// heightOf returns the number of terminal lines a rendered string occupies.
func heightOf(rendered string) int {
	if rendered == "" {
		return 0
	}
	return lipgloss.Height(rendered)
}

