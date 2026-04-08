package main

import (
	"bytes"
	"regexp"
	"strings"

	"github.com/alecthomas/chroma/v2"
	"github.com/alecthomas/chroma/v2/formatters"
	"github.com/alecthomas/chroma/v2/lexers"
	chromaStyles "github.com/alecthomas/chroma/v2/styles"
)

// codeBlockRe matches fenced code blocks in markdown: ```lang\ncode\n```
var codeBlockRe = regexp.MustCompile("(?m)^```(\\w*)\\s*\n([\\s\\S]*?)^```\\s*$")

// highlightCodeBlocks finds fenced code blocks in markdown text and replaces
// them with Chroma syntax-highlighted versions. Non-code text is left as-is.
func highlightCodeBlocks(text, chromaStyle string) string {
	if !strings.Contains(text, "```") {
		return text
	}

	return codeBlockRe.ReplaceAllStringFunc(text, func(match string) string {
		parts := codeBlockRe.FindStringSubmatch(match)
		if len(parts) < 3 {
			return match
		}
		lang := parts[1]
		code := parts[2]

		highlighted := highlightCode(code, lang, chromaStyle)
		if highlighted == "" {
			return match // Fallback to original on error
		}
		return highlighted
	})
}

// highlightCode renders a code string with Chroma syntax highlighting
// using terminal256 colors. chromaStyle selects the Chroma theme (e.g. "monokai", "github").
func highlightCode(code, language, chromaStyle string) string {
	// Get lexer
	var lexer chroma.Lexer
	if language != "" {
		lexer = lexers.Get(language)
	}
	if lexer == nil {
		lexer = lexers.Analyse(code)
	}
	if lexer == nil {
		lexer = lexers.Fallback
	}
	lexer = chroma.Coalesce(lexer)

	// Use theme-aware style
	style := chromaStyles.Get(chromaStyle)
	if style == nil {
		style = chromaStyles.Fallback
	}

	// Terminal256 formatter
	formatter := formatters.Get("terminal256")
	if formatter == nil {
		formatter = formatters.Fallback
	}

	// Tokenize
	iterator, err := lexer.Tokenise(nil, code)
	if err != nil {
		return ""
	}

	// Render
	var buf bytes.Buffer
	if err := formatter.Format(&buf, style, iterator); err != nil {
		return ""
	}

	return buf.String()
}

// highlightToolResult applies syntax highlighting to a tool result string
// if it appears to contain code (detected by file extension or content heuristics).
func highlightToolResult(content, toolName, chromaStyle string, params map[string]interface{}) string {
	// Only highlight for certain tools where output is code
	switch toolName {
	case "Read":
		// Detect language from file path
		if fp, ok := params["file_path"]; ok {
			if path, ok := fp.(string); ok {
				lang := detectLangFromPath(path)
				if lang != "" {
					return highlightCode(content, lang, chromaStyle)
				}
			}
		}
	}
	return content
}

// detectLangFromPath guesses the language from a file path extension.
func detectLangFromPath(path string) string {
	lexer := lexers.Match(path)
	if lexer != nil {
		return lexer.Config().Name
	}
	return ""
}
