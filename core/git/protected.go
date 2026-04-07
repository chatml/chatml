package git

// ProtectedBranchNames contains branch names that sessions should never use.
// These are typically the main/default branches that should not be checked out
// in isolated worktrees for session work.
var ProtectedBranchNames = map[string]bool{
	"main":    true,
	"master":  true,
	"develop": true,
}

// IsProtectedBranch checks if a branch name is protected.
// Protected branches cannot be used for session worktrees.
func IsProtectedBranch(name string) bool {
	return ProtectedBranchNames[name]
}
