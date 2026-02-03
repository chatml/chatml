package store

import (
	"context"
	"database/sql"
	"time"

	"github.com/google/uuid"
)

// ListInstalledSkillIDs returns the IDs of all installed skills
func (s *SQLiteStore) ListInstalledSkillIDs(ctx context.Context) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT skill_id FROM user_skill_preferences`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

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

// GetSkillInstalledAt returns when a skill was installed (nil if not installed)
func (s *SQLiteStore) GetSkillInstalledAt(ctx context.Context, skillID string) (*time.Time, error) {
	var installedAt time.Time
	err := s.db.QueryRowContext(ctx, `SELECT installed_at FROM user_skill_preferences WHERE skill_id = ?`, skillID).Scan(&installedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &installedAt, nil
}
