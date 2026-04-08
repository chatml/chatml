package store

import (
	"context"
	"fmt"
	"time"

	"github.com/chatml/chatml-backend/logger"
)

// Backup creates a backup of the database using VACUUM INTO.
// The backup is written to dbPath + ".backup".
func (s *SQLiteStore) Backup(ctx context.Context) error {
	if s.dbPath == "" || s.dbPath == ":memory:" {
		return fmt.Errorf("cannot backup in-memory database")
	}

	dest := s.dbPath + ".backup"
	start := time.Now()

	_, err := s.db.ExecContext(ctx, `VACUUM INTO ?`, dest)
	if err != nil {
		return fmt.Errorf("backup failed: %w", err)
	}

	logger.Store.Infof("Database backed up to %s (took %s)", dest, time.Since(start).Round(time.Millisecond))
	return nil
}

// StartPeriodicBackup runs Backup on the given interval in a background goroutine.
// Stops when the context is cancelled.
func (s *SQLiteStore) StartPeriodicBackup(ctx context.Context, interval time.Duration) {
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for {
			select {
			case <-ticker.C:
				if err := s.Backup(ctx); err != nil {
					logger.Store.Warnf("Periodic backup failed: %v", err)
				}
			case <-ctx.Done():
				return
			}
		}
	}()
}
