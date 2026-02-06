package store

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// InstallSkill records a skill as installed
func (s *SQLiteStore) InstallSkill(ctx context.Context, skillID string) error {
	id := uuid.New().String()
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO user_skill_preferences (id, skill_id, installed_at)
		VALUES (?, ?, ?)
		ON CONFLICT(skill_id) DO NOTHING
	`, id, skillID, time.Now())
	return err
}

// UninstallSkill removes a skill from installed list
func (s *SQLiteStore) UninstallSkill(ctx context.Context, skillID string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM user_skill_preferences WHERE skill_id = ?`, skillID)
	return err
}

// ListInstalledSkillsWithTimestamps returns a map of skill_id -> installed_at for all installed skills
func (s *SQLiteStore) ListInstalledSkillsWithTimestamps(ctx context.Context) (map[string]time.Time, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT skill_id, installed_at FROM user_skill_preferences`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[string]time.Time)
	for rows.Next() {
		var skillID string
		var installedAt time.Time
		if err := rows.Scan(&skillID, &installedAt); err != nil {
			return nil, err
		}
		result[skillID] = installedAt
	}
	return result, rows.Err()
}
