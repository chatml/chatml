package naming

import "testing"

func TestExtractSessionNameFromBranch(t *testing.T) {
	tests := []struct {
		branch   string
		expected string
	}{
		// Session prefix
		{"session/tokyo", "tokyo"},
		{"session/fix-auth-bug", "fix-auth-bug"},

		// Feature/fix prefixes
		{"feature/add-login", "add-login"},
		{"fix/critical-issue", "critical-issue"},
		{"bugfix/memory-leak", "memory-leak"},
		{"hotfix/security-patch", "security-patch"},
		{"chore/update-deps", "update-deps"},
		{"refactor/cleanup-code", "cleanup-code"},
		{"docs/add-readme", "add-readme"},
		{"test/add-unit-tests", "add-unit-tests"},

		// Username prefixes
		{"mcastilho/my-feature", "my-feature"},
		{"john.doe/fix-bug", "fix-bug"},
		{"user-name/add-feature", "add-feature"},
		{"user_name/add-feature", "add-feature"},

		// No prefix
		{"main", "main"},
		{"develop", "develop"},
		{"my-branch", "my-branch"},

		// Nested slashes
		{"mcastilho/session/nested", "nested"},
		{"user/feature/deep/nested", "nested"},

		// Edge cases
		{"", ""},
		{"/leading-slash", "leading-slash"},
		{"trailing-slash/", ""},
	}

	for _, tt := range tests {
		t.Run(tt.branch, func(t *testing.T) {
			result := ExtractSessionNameFromBranch(tt.branch)
			if result != tt.expected {
				t.Errorf("ExtractSessionNameFromBranch(%q) = %q, want %q",
					tt.branch, result, tt.expected)
			}
		})
	}
}
