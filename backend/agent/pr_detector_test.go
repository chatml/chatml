package agent

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestDetectPRCreation_GhPrCreate(t *testing.T) {
	d := NewPRDetector()

	result := d.DetectPRCreation(
		"gh pr create --title 'Fix bug' --body 'Details'",
		"https://github.com/owner/repo/pull/123\n",
	)

	assert.True(t, result.Detected)
	assert.Equal(t, 123, result.PRNumber)
}

func TestDetectPRCreation_JSONResponse(t *testing.T) {
	d := NewPRDetector()

	result := d.DetectPRCreation(
		"gh pr create --title 'Fix bug'",
		`{"html_url": "https://github.com/owner/repo/pull/456", "number": 456}`,
	)

	assert.True(t, result.Detected)
	assert.Equal(t, 456, result.PRNumber)
	assert.Equal(t, "https://github.com/owner/repo/pull/456", result.PRURL)
}

func TestDetectPRCreation_NotACreateCommand(t *testing.T) {
	d := NewPRDetector()

	// gh pr view should NOT trigger PR detection
	result := d.DetectPRCreation(
		"gh pr view 123",
		"https://github.com/owner/repo/pull/123\n",
	)

	assert.False(t, result.Detected)
}

func TestDetectPRCreation_NoMatch(t *testing.T) {
	d := NewPRDetector()

	result := d.DetectPRCreation(
		"gh pr create --title 'Fix'",
		"Error: could not create PR\n",
	)

	assert.False(t, result.Detected)
}

func TestDetectPRMerge_MergedMessage(t *testing.T) {
	d := NewPRDetector()

	assert.True(t, d.DetectPRMerge("Merged pull request #123"))
	assert.True(t, d.DetectPRMerge("Pull request #42 was already merged"))
	assert.True(t, d.DetectPRMerge("successfully merged"))
}

func TestDetectPRMerge_NoMatch(t *testing.T) {
	d := NewPRDetector()

	assert.False(t, d.DetectPRMerge("PR is open"))
	assert.False(t, d.DetectPRMerge("just some output"))
}

func TestDetectGitPush_NewBranch(t *testing.T) {
	d := NewPRDetector()

	assert.True(t, d.DetectGitPush(
		"git push -u origin feature",
		" * [new branch]      feature -> feature\n",
	))
}

func TestDetectGitPush_NormalPush(t *testing.T) {
	d := NewPRDetector()

	assert.True(t, d.DetectGitPush(
		"git push",
		"   abc1234..def5678  feature -> feature\n",
	))
}

func TestDetectGitPush_NotAPushCommand(t *testing.T) {
	d := NewPRDetector()

	// git fetch produces similar stderr but should not trigger
	assert.False(t, d.DetectGitPush(
		"git fetch origin",
		" * [new branch]      feature -> feature\n",
	))
}

func TestDetectGitPush_NoMatch(t *testing.T) {
	d := NewPRDetector()

	assert.False(t, d.DetectGitPush(
		"git push",
		"Everything up-to-date\n",
	))
}
