package git

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestIsProtectedBranch(t *testing.T) {
	// Protected branches should return true
	assert.True(t, IsProtectedBranch("main"))
	assert.True(t, IsProtectedBranch("master"))
	assert.True(t, IsProtectedBranch("develop"))

	// Non-protected branches should return false
	assert.False(t, IsProtectedBranch("feature/new-thing"))
	assert.False(t, IsProtectedBranch("fix/bug-123"))
	assert.False(t, IsProtectedBranch("session/happy-panda"))
	assert.False(t, IsProtectedBranch("dev")) // not the same as develop
	assert.False(t, IsProtectedBranch("main-feature"))
	assert.False(t, IsProtectedBranch(""))
}
