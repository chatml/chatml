package agent

import (
	"regexp"
	"strconv"
)

// PRDetector detects PR creation, merge, and git push events from agent output.
// It encapsulates all the regex patterns and detection logic that was previously
// spread across manager.go.
type PRDetector struct{}

// NewPRDetector creates a new PRDetector.
func NewPRDetector() *PRDetector {
	return &PRDetector{}
}

// PR detection patterns — compiled once, used for matching agent output.
var (
	// prURLPattern matches GitHub PR URLs in tool output.
	// Capture group 1 = PR number.
	prURLPattern = regexp.MustCompile(`github\.com/[^/]+/[^/]+/pull/(\d+)`)

	// prJSONPattern matches GitHub API JSON responses containing a PR URL.
	// Capture group 1 = full URL, capture group 2 = PR number.
	prJSONPattern = regexp.MustCompile(`"html_url"\s*:\s*"(https://github\.com/[^/]+/[^/]+/pull/(\d+))"`)

	// prCreationCommandPattern matches Bash commands likely to create a PR.
	// Guards against false positives from display commands (gh pr view, gh pr list).
	prCreationCommandPattern = regexp.MustCompile(`(?:gh\s+pr\s+create|curl\s+.*api\.github\.com.*/pulls)`)

	// prMergedPattern matches merge confirmation messages in Bash stdout.
	prMergedPattern = regexp.MustCompile(`(?i)(merged\s+pull\s+request|pull\s+request\s+.+\s+was\s+already\s+merged|successfully\s+merged)`)

	// gitPushPattern matches successful git push output in stderr.
	gitPushPattern = regexp.MustCompile(`(\[new branch\]|[a-f0-9]+\.\.\.?[a-f0-9]+)\s+.+\s+->\s+`)

	// gitPushCommandPattern matches commands that are actually git push (not fetch/pull).
	gitPushCommandPattern = regexp.MustCompile(`git\s+push\b`)
)

// PRDetectionResult holds the result of a PR creation detection.
type PRDetectionResult struct {
	Detected bool
	PRNumber int
	PRURL    string
}

// DetectPRCreation checks bash command + stdout for signs that a PR was created.
// Returns the detected PR number and URL, or zero values if not detected.
func (d *PRDetector) DetectPRCreation(bashCmd, stdout string) PRDetectionResult {
	// Only look for PR URLs if the command is a PR creation command
	if !prCreationCommandPattern.MatchString(bashCmd) {
		return PRDetectionResult{}
	}

	// Try JSON pattern first (more specific)
	if matches := prJSONPattern.FindStringSubmatch(stdout); len(matches) >= 3 {
		prNum, _ := strconv.Atoi(matches[2])
		return PRDetectionResult{Detected: true, PRNumber: prNum, PRURL: matches[1]}
	}

	// Fall back to URL pattern
	if matches := prURLPattern.FindStringSubmatch(stdout); len(matches) >= 2 {
		prNum, _ := strconv.Atoi(matches[1])
		// Reconstruct the full URL from the match
		fullURL := ""
		if loc := prURLPattern.FindStringIndex(stdout); loc != nil {
			// Find the https:// prefix before the match
			start := loc[0]
			for start > 0 && stdout[start-1] != '"' && stdout[start-1] != ' ' && stdout[start-1] != '\n' {
				start--
			}
			fullURL = stdout[start:loc[1]]
			if len(fullURL) > 0 && fullURL[0] != 'h' {
				fullURL = "https://" + fullURL
			}
		}
		return PRDetectionResult{Detected: true, PRNumber: prNum, PRURL: fullURL}
	}

	return PRDetectionResult{}
}

// DetectPRMerge checks bash stdout for signs that a PR was merged.
func (d *PRDetector) DetectPRMerge(stdout string) bool {
	return prMergedPattern.MatchString(stdout)
}

// DetectGitPush checks a bash command + stderr for signs of a successful git push.
func (d *PRDetector) DetectGitPush(bashCmd, stderr string) bool {
	if !gitPushCommandPattern.MatchString(bashCmd) {
		return false
	}
	return gitPushPattern.MatchString(stderr)
}
