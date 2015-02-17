package util

import (
	"time"

	"github.com/chatml/server/util/log"
)

// RetryOptions provides control of retry loop logic via the
// RetryWithBackoffOptions method.
type RetryOptions struct {
	Tag         string        // Tag for helpful logging of backoffs
	Backoff     time.Duration // Default retry backoff interval
	MaxBackoff  time.Duration // Maximum retry backoff interval
	Constant    float64       // Default backoff constant
	MaxAttempts int           // Maximum number of attempts (0 for infinite)
}

// RetryWithBackoff implements retry with exponential backoff using
// the supplied options as parameters. When fn returns false and the
// number of retry attempts haven't been exhausted, fn is
// retried. When fn returns true, retry ends. Returns an error if the
// maximum number of retries is exceeded or if the fn returns an
// error.
func RetryWithBackoff(opts RetryOptions, fn func() (bool, error)) error {
	backoff := opts.Backoff
	for count := 1; true; count++ {
		if done, err := fn(); done || err != nil {
			return err
		}
		if opts.MaxAttempts > 0 && count >= opts.MaxAttempts {
			return Errorf("exceeded maximum retry attempts: %d", opts.MaxAttempts)
		}
		log.Infof("%s failed; retrying in %s", opts.Tag, backoff)
		select {
		case <-time.After(backoff):
			// Increase backoff.
			backoff = time.Duration(float64(backoff) * opts.Constant)
			if backoff > opts.MaxBackoff {
				backoff = opts.MaxBackoff
			}
		}
	}
	return nil
}
