package naming

import (
	"regexp"
	"strings"
)

// Common branch prefixes to strip when extracting session names
var branchPrefixes = []string{
	"session/",
	"feature/",
	"fix/",
	"bugfix/",
	"hotfix/",
	"chore/",
	"refactor/",
	"docs/",
	"test/",
}

// usernamePattern matches username prefixes like "mcastilho/" or "john.doe/"
var usernamePattern = regexp.MustCompile(`^[a-zA-Z0-9._-]+/`)

// ExtractSessionNameFromBranch extracts a display name from a git branch name.
// It strips common prefixes like "session/", "feature/", and username prefixes.
//
// For branches with multiple slashes after prefix stripping, only the last segment
// is returned. This is intentional to keep session names short and readable in the UI.
// For example, "user/feature/deep/nested" returns "nested" rather than "deep/nested".
//
// Examples:
//   - "session/orion" -> "orion"
//   - "mcastilho/fix-auth" -> "fix-auth"
//   - "feature/add-login" -> "add-login"
//   - "main" -> "main"
//   - "user/feature/deep/nested" -> "nested"
func ExtractSessionNameFromBranch(branchName string) string {
	name := branchName

	// Strip known prefixes
	for _, prefix := range branchPrefixes {
		if strings.HasPrefix(name, prefix) {
			name = strings.TrimPrefix(name, prefix)
			break // Only strip one prefix
		}
	}

	// If still has a slash, might be username prefix
	if strings.Contains(name, "/") {
		if match := usernamePattern.FindString(name); match != "" {
			name = strings.TrimPrefix(name, match)
		}
	}

	// Handle multiple slashes - take last segment as fallback
	if strings.Contains(name, "/") {
		parts := strings.Split(name, "/")
		name = parts[len(parts)-1]
	}

	return name
}
