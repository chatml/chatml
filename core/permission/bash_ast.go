package permission

import (
	"strings"
	"unicode"
)

// BashParseResult is the result of bash command security analysis.
type BashParseResult struct {
	Kind     string          // "simple", "too-complex", "parse-error"
	Commands []SimpleCommand // Only populated when Kind == "simple"
	Reason   string          // Explanation when Kind != "simple"
}

// SimpleCommand is an extracted command from bash parsing.
type SimpleCommand struct {
	Argv      []string          // argv[0] = command name, rest = arguments
	EnvVars   map[string]string // KEY=VALUE assignments before the command
	Redirects []Redirect        // Output/input redirections
	Text      string            // Original text span
}

// Redirect represents a shell I/O redirection.
type Redirect struct {
	Op     string // ">", ">>", "<", "2>", "2>>", "&>", "&>>"
	Target string
}

// ParseBashForSecurity performs fail-closed bash command parsing.
// Only interprets constructs on an explicit allowlist. Anything unrecognized
// is classified as "too-complex" — never silently allows complex commands.
//
// This is a pure-Go implementation matching Claude Code's tree-sitter-based
// fail-closed approach without requiring CGO.
func ParseBashForSecurity(command string) BashParseResult {
	command = strings.TrimSpace(command)
	if command == "" {
		return BashParseResult{Kind: "simple"}
	}

	// Reject obviously complex constructs outright
	if containsComplexConstruct(command) {
		return BashParseResult{
			Kind:   "too-complex",
			Reason: "command contains complex shell constructs",
		}
	}

	// Split on allowed separators: &&, ||, |, ;, &
	segments := splitOnSeparators(command)
	if segments == nil {
		return BashParseResult{
			Kind:   "too-complex",
			Reason: "failed to split command on separators",
		}
	}

	var commands []SimpleCommand
	for _, seg := range segments {
		seg = strings.TrimSpace(seg)
		if seg == "" {
			continue
		}

		cmd, err := parseSimpleCommand(seg)
		if err != "" {
			return BashParseResult{
				Kind:   "too-complex",
				Reason: err,
			}
		}
		if cmd != nil {
			commands = append(commands, *cmd)
		}
	}

	return BashParseResult{
		Kind:     "simple",
		Commands: commands,
	}
}

// IsDangerousCommandAST uses the AST parser for more accurate command analysis.
// Falls back to the simple string-based check if parsing fails.
func IsDangerousCommandAST(command string) bool {
	result := ParseBashForSecurity(command)

	switch result.Kind {
	case "too-complex":
		// Fail-closed: complex commands are always treated as dangerous
		return true

	case "simple":
		for _, cmd := range result.Commands {
			if len(cmd.Argv) == 0 {
				continue
			}

			// Check argv[0] against dangerous commands list
			base := cmd.Argv[0]
			if idx := strings.LastIndex(base, "/"); idx >= 0 {
				base = base[idx+1:]
			}
			if dangerousCommands[base] {
				return true
			}

			// Check for dangerous redirections (overwriting files)
			for _, redir := range cmd.Redirects {
				if redir.Op == ">" || redir.Op == "&>" {
					// Overwriting a file — potentially dangerous
					if IsDangerousPath(redir.Target) {
						return true
					}
				}
			}
		}
		return false

	default:
		// Parse error — fail closed
		return true
	}
}

// containsComplexConstruct detects shell features that make the command too
// complex for safe static analysis. Fail-closed: if we see any of these,
// the command requires user approval.
func containsComplexConstruct(cmd string) bool {
	// Process substitution: <(...) or >(...)
	if strings.Contains(cmd, "<(") || strings.Contains(cmd, ">(") {
		return true
	}

	// Command substitution with backticks (harder to parse)
	if strings.Contains(cmd, "`") {
		return true
	}

	// Here documents: check for << that isn't part of <<< (here-string)
	if strings.Contains(cmd, "<<") {
		// Remove all <<< occurrences, then check if << still remains
		temp := strings.ReplaceAll(cmd, "<<<", "")
		if strings.Contains(temp, "<<") {
			return true
		}
	}

	// Function definitions
	if strings.Contains(cmd, "() {") || strings.Contains(cmd, "(){") {
		return true
	}

	// Arithmetic evaluation
	// NOTE: Bare (( may false-positive on nested parens in arguments. This is fail-closed (safe direction).
	if strings.Contains(cmd, "$((") || strings.Contains(cmd, "((") {
		return true
	}

	// Array syntax
	if strings.Contains(cmd, "=(") {
		return true
	}

	// Control flow keywords that indicate complex scripts
	for _, kw := range []string{" if ", " then ", " else ", " elif ", " fi ",
		" for ", " while ", " until ", " do ", " done ",
		" case ", " esac ", " select "} {
		if strings.Contains(" "+cmd+" ", kw) {
			return true
		}
	}

	return false
}

// splitOnSeparators splits a command on &&, ||, |, ;, & while respecting quotes.
func splitOnSeparators(cmd string) []string {
	var segments []string
	var current strings.Builder
	i := 0
	inSingleQuote := false
	inDoubleQuote := false

	for i < len(cmd) {
		ch := cmd[i]

		// Handle quotes
		if ch == '\'' && !inDoubleQuote {
			inSingleQuote = !inSingleQuote
			current.WriteByte(ch)
			i++
			continue
		}
		if ch == '"' && !inSingleQuote {
			inDoubleQuote = !inDoubleQuote
			current.WriteByte(ch)
			i++
			continue
		}

		// Inside quotes, everything is literal
		if inSingleQuote || inDoubleQuote {
			current.WriteByte(ch)
			i++
			continue
		}

		// Check for separators
		if ch == '&' && i+1 < len(cmd) && cmd[i+1] == '&' {
			segments = append(segments, current.String())
			current.Reset()
			i += 2
			continue
		}
		if ch == '|' && i+1 < len(cmd) && cmd[i+1] == '|' {
			segments = append(segments, current.String())
			current.Reset()
			i += 2
			continue
		}
		if ch == '|' {
			segments = append(segments, current.String())
			current.Reset()
			i++
			continue
		}
		if ch == ';' {
			segments = append(segments, current.String())
			current.Reset()
			i++
			continue
		}
		if ch == '&' {
			// Background operator — treat as separator
			segments = append(segments, current.String())
			current.Reset()
			i++
			continue
		}

		current.WriteByte(ch)
		i++
	}

	// Unclosed quotes — fail closed
	if inSingleQuote || inDoubleQuote {
		return nil
	}

	if current.Len() > 0 {
		segments = append(segments, current.String())
	}

	return segments
}

// parseSimpleCommand parses a single command segment into a SimpleCommand.
// Returns nil if the segment is empty, or an error reason if too complex.
func parseSimpleCommand(segment string) (*SimpleCommand, string) {
	tokens := tokenize(segment)
	if len(tokens) == 0 {
		return nil, ""
	}

	cmd := &SimpleCommand{
		EnvVars: make(map[string]string),
		Text:    segment,
	}

	i := 0

	// Parse leading VAR=VALUE assignments
	for i < len(tokens) {
		tok := tokens[i]
		if eqIdx := strings.Index(tok, "="); eqIdx > 0 && !strings.HasPrefix(tok, "-") {
			key := tok[:eqIdx]
			if isValidEnvName(key) {
				cmd.EnvVars[key] = tok[eqIdx+1:]
				i++
				continue
			}
		}
		break
	}

	// Skip command wrappers (env, command, nohup, time, nice, etc.)
	commandWrappers := map[string]bool{
		"env": true, "command": true, "xargs": true,
		"nohup": true, "time": true, "nice": true, "ionice": true, "strace": true,
	}
	for i < len(tokens) {
		tok := stripQuotes(tokens[i])
		if !commandWrappers[tok] {
			break
		}
		i++
		// Skip flags after wrapper
		for i < len(tokens) && strings.HasPrefix(tokens[i], "-") {
			i++
		}
		// Skip any env var assignments after wrapper
		for i < len(tokens) {
			t := tokens[i]
			if eqIdx := strings.Index(t, "="); eqIdx > 0 && !strings.HasPrefix(t, "-") {
				key := t[:eqIdx]
				if isValidEnvName(key) {
					cmd.EnvVars[key] = t[eqIdx+1:]
					i++
					continue
				}
			}
			break
		}
	}

	// Parse command and arguments
	for i < len(tokens) {
		tok := tokens[i]

		// Check for redirections
		if isRedirectionOp(tok) {
			if i+1 >= len(tokens) {
				return nil, "redirection without target"
			}
			cmd.Redirects = append(cmd.Redirects, Redirect{
				Op:     tok,
				Target: stripQuotes(tokens[i+1]),
			})
			i += 2
			continue
		}

		// Check for $(...) command substitution
		// NOTE: $( inside single-quoted strings is a false positive (not a real substitution),
		// but this is fail-closed (safe direction).
		if strings.Contains(tok, "$(") {
			return nil, "command substitution ($(...)) detected"
		}

		cmd.Argv = append(cmd.Argv, stripQuotes(tok))
		i++
	}

	if len(cmd.Argv) == 0 && len(cmd.EnvVars) > 0 {
		// Just variable assignments, no command — safe
		return cmd, ""
	}

	return cmd, ""
}

// tokenize splits a command into tokens, respecting quotes.
func tokenize(cmd string) []string {
	var tokens []string
	var current strings.Builder
	i := 0
	inSingleQuote := false
	inDoubleQuote := false
	// escaped tracks whether the PREVIOUS character was an unescaped backslash
	// inside double quotes. This correctly handles \" (escaped quote) vs \\"
	// (escaped backslash + closing quote). Reset after each character is consumed.
	escaped := false

	for i < len(cmd) {
		ch := cmd[i]

		if ch == '\'' && !inDoubleQuote {
			inSingleQuote = !inSingleQuote
			current.WriteByte(ch)
			i++
			escaped = false
			continue
		}
		if ch == '"' && !inSingleQuote {
			if inDoubleQuote && escaped {
				// \" inside double quotes — literal quote, not end-of-string
				current.WriteByte(ch)
				i++
				escaped = false
				continue
			}
			inDoubleQuote = !inDoubleQuote
			current.WriteByte(ch)
			i++
			escaped = false
			continue
		}

		if inSingleQuote {
			current.WriteByte(ch)
			i++
			continue
		}

		if inDoubleQuote {
			// Inside double quotes, backslash escapes: \" \$ \` \\ \newline
			if ch == '\\' && i+1 < len(cmd) {
				next := cmd[i+1]
				current.WriteByte(ch)
				current.WriteByte(next)
				i += 2
				// \\ consumes both — the second \ is NOT an escape prefix.
				// Only a single \ before " $ ` or newline sets escaped=true.
				escaped = next != '\\'
				continue
			}
			current.WriteByte(ch)
			i++
			escaped = false
			continue
		}

		// Escape character (outside quotes)
		if ch == '\\' && i+1 < len(cmd) {
			current.WriteByte(ch)
			current.WriteByte(cmd[i+1])
			i += 2
			continue
		}

		// Whitespace breaks tokens
		if unicode.IsSpace(rune(ch)) {
			if current.Len() > 0 {
				tokens = append(tokens, current.String())
				current.Reset()
			}
			i++
			continue
		}

		// Redirection operators
		if ch == '>' || ch == '<' {
			if current.Len() > 0 {
				tokens = append(tokens, current.String())
				current.Reset()
			}
			// Handle multi-char redirections: >>, 2>, 2>>, &>, &>>
			op := string(ch)
			if ch == '>' && i+1 < len(cmd) && cmd[i+1] == '>' {
				op = ">>"
				i++
			}
			tokens = append(tokens, op)
			i++
			continue
		}

		// Handle 2> and 2>> (stderr redirection)
		// Only match 2> as stderr redirect when '2' starts a new token (not mid-word like "abc2>")
		if ch == '2' && i+1 < len(cmd) && cmd[i+1] == '>' && current.Len() == 0 {
			if i+2 < len(cmd) && cmd[i+2] == '>' {
				tokens = append(tokens, "2>>")
				i += 3
			} else {
				tokens = append(tokens, "2>")
				i += 2
			}
			continue
		}

		// Handle &> and &>>
		if ch == '&' && i+1 < len(cmd) && cmd[i+1] == '>' {
			if current.Len() > 0 {
				tokens = append(tokens, current.String())
				current.Reset()
			}
			if i+2 < len(cmd) && cmd[i+2] == '>' {
				tokens = append(tokens, "&>>")
				i += 3
			} else {
				tokens = append(tokens, "&>")
				i += 2
			}
			continue
		}

		current.WriteByte(ch)
		i++
	}

	if current.Len() > 0 {
		tokens = append(tokens, current.String())
	}

	return tokens
}

func isRedirectionOp(tok string) bool {
	switch tok {
	case ">", ">>", "<", "2>", "2>>", "&>", "&>>":
		return true
	}
	return false
}

func isValidEnvName(name string) bool {
	if name == "" {
		return false
	}
	for i, ch := range name {
		if i == 0 && !unicode.IsLetter(ch) && ch != '_' {
			return false
		}
		if !unicode.IsLetter(ch) && !unicode.IsDigit(ch) && ch != '_' {
			return false
		}
	}
	return true
}

// stripQuotes removes all quote characters from a token to extract the effective
// command name. In bash, concatenated quoted strings like 'cu'"rl" evaluate to
// "curl". Simply stripping matching outer quotes would miss this case, so we
// remove all single and double quotes entirely. This is intentionally aggressive:
// a false positive (flagging a safe command) is better than a false negative
// (missing a dangerous command hidden behind quote concatenation).
func stripQuotes(s string) string {
	// Fast path: no quotes at all
	if !strings.ContainsAny(s, `'"`) {
		return s
	}

	var b strings.Builder
	b.Grow(len(s))
	for _, ch := range s {
		if ch != '\'' && ch != '"' {
			b.WriteRune(ch)
		}
	}
	return b.String()
}
