package store

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestInstallSkill_Success(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	err := s.InstallSkill(ctx, "skill-alpha")
	require.NoError(t, err)

	skills, err := s.ListInstalledSkillsWithTimestamps(ctx)
	require.NoError(t, err)
	require.Len(t, skills, 1)

	installedAt, ok := skills["skill-alpha"]
	assert.True(t, ok, "skill-alpha should be in the map")
	assert.WithinDuration(t, time.Now(), installedAt, 5*time.Second)
}

func TestInstallSkill_Idempotent(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	// Install the same skill twice
	require.NoError(t, s.InstallSkill(ctx, "skill-beta"))
	require.NoError(t, s.InstallSkill(ctx, "skill-beta"))

	skills, err := s.ListInstalledSkillsWithTimestamps(ctx)
	require.NoError(t, err)
	assert.Len(t, skills, 1, "duplicate install should result in only one entry")
}

func TestListInstalledSkills_Empty(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	skills, err := s.ListInstalledSkillsWithTimestamps(ctx)
	require.NoError(t, err)
	require.NotNil(t, skills)
	assert.Empty(t, skills)
}

func TestListInstalledSkills_Multiple(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	require.NoError(t, s.InstallSkill(ctx, "skill-1"))
	require.NoError(t, s.InstallSkill(ctx, "skill-2"))
	require.NoError(t, s.InstallSkill(ctx, "skill-3"))

	skills, err := s.ListInstalledSkillsWithTimestamps(ctx)
	require.NoError(t, err)
	assert.Len(t, skills, 3)

	for _, id := range []string{"skill-1", "skill-2", "skill-3"} {
		ts, ok := skills[id]
		assert.True(t, ok, "%s should be present", id)
		assert.False(t, ts.IsZero(), "%s should have a non-zero timestamp", id)
	}
}

func TestUninstallSkill_Success(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	require.NoError(t, s.InstallSkill(ctx, "skill-gamma"))

	// Verify installed
	skills, err := s.ListInstalledSkillsWithTimestamps(ctx)
	require.NoError(t, err)
	require.Len(t, skills, 1)

	// Uninstall
	require.NoError(t, s.UninstallSkill(ctx, "skill-gamma"))

	// Verify gone
	skills, err = s.ListInstalledSkillsWithTimestamps(ctx)
	require.NoError(t, err)
	assert.Empty(t, skills)
}

func TestUninstallSkill_NonExistent(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	// Uninstalling a skill that was never installed should not error
	err := s.UninstallSkill(ctx, "nonexistent-skill")
	assert.NoError(t, err)
}

func TestInstallUninstallReinstall(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	// Install
	require.NoError(t, s.InstallSkill(ctx, "skill-lifecycle"))
	skills, err := s.ListInstalledSkillsWithTimestamps(ctx)
	require.NoError(t, err)
	require.Len(t, skills, 1)
	originalTimestamp := skills["skill-lifecycle"]

	// Small sleep so reinstall timestamp differs
	time.Sleep(10 * time.Millisecond)

	// Uninstall
	require.NoError(t, s.UninstallSkill(ctx, "skill-lifecycle"))
	skills, err = s.ListInstalledSkillsWithTimestamps(ctx)
	require.NoError(t, err)
	assert.Empty(t, skills)

	// Reinstall
	require.NoError(t, s.InstallSkill(ctx, "skill-lifecycle"))
	skills, err = s.ListInstalledSkillsWithTimestamps(ctx)
	require.NoError(t, err)
	require.Len(t, skills, 1)

	reinstallTimestamp := skills["skill-lifecycle"]
	assert.False(t, reinstallTimestamp.IsZero())
	// After uninstall+reinstall, the row is new so timestamp should be >= original
	assert.True(t, !reinstallTimestamp.Before(originalTimestamp),
		"reinstall timestamp should be >= original timestamp")
}
