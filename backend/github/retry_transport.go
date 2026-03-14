package github

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"strconv"
	"time"

	"github.com/chatml/chatml-backend/logger"
)

// retryTransport wraps an http.RoundTripper with automatic retry and
// exponential backoff for GitHub API rate-limit responses (429 and 403).
type retryTransport struct {
	base       http.RoundTripper
	maxRetries int
	baseDelay  time.Duration
}

func (t *retryTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	// Buffer the request body so it can be replayed on retry.
	if req.Body != nil && req.GetBody == nil {
		bodyBytes, err := io.ReadAll(req.Body)
		if err != nil {
			return nil, fmt.Errorf("reading request body for retry: %w", err)
		}
		req.Body.Close()
		req.Body = io.NopCloser(bytes.NewReader(bodyBytes))
		req.GetBody = func() (io.ReadCloser, error) {
			return io.NopCloser(bytes.NewReader(bodyBytes)), nil
		}
	}

	var resp *http.Response
	var err error

	for attempt := 0; attempt <= t.maxRetries; attempt++ {
		// Reset body for retries.
		if attempt > 0 && req.GetBody != nil {
			req.Body, err = req.GetBody()
			if err != nil {
				return nil, fmt.Errorf("resetting request body for retry: %w", err)
			}
		}

		resp, err = t.base.RoundTrip(req)
		if err != nil {
			// Don't retry context cancellation or deadline exceeded.
			if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
				return nil, err
			}
			// Last attempt — return the network error as-is.
			if attempt == t.maxRetries {
				return nil, err
			}
			wait := t.backoffDelay(attempt)
			logger.GitHub.Warnf("GitHub request failed (%v), retry %d/%d in %v",
				err, attempt+1, t.maxRetries, wait)

			select {
			case <-time.After(wait):
			case <-req.Context().Done():
				return nil, req.Context().Err()
			}
			continue
		}

		if !isRateLimited(resp) {
			return resp, nil
		}

		// Last attempt — return the rate-limited response as-is.
		if attempt == t.maxRetries {
			return resp, nil
		}

		wait := t.retryDelay(resp, attempt)
		logger.GitHub.Warnf("GitHub rate limited (HTTP %d), retry %d/%d in %v",
			resp.StatusCode, attempt+1, t.maxRetries, wait)

		// Drain and close body to free the connection.
		io.Copy(io.Discard, resp.Body)
		resp.Body.Close()

		// Sleep with context cancellation support.
		select {
		case <-time.After(wait):
		case <-req.Context().Done():
			return nil, req.Context().Err()
		}
	}

	return resp, nil
}

// backoffDelay returns an exponential backoff duration for network errors
// (no response headers available).
func (t *retryTransport) backoffDelay(attempt int) time.Duration {
	backoff := t.baseDelay * (1 << uint(attempt))
	return clampAndJitter(backoff)
}

// retryDelay computes how long to wait before the next retry attempt.
// It checks Retry-After and X-RateLimit-Reset headers first, falling back
// to exponential backoff. Jitter of ±50% is added and the result is capped
// at 10 seconds.
func (t *retryTransport) retryDelay(resp *http.Response, attempt int) time.Duration {
	if d := parseRetryAfter(resp); d > 0 {
		return clampAndJitter(d)
	}
	if d := parseRateLimitReset(resp); d > 0 {
		return clampAndJitter(d)
	}
	// Exponential backoff: baseDelay * 2^attempt
	backoff := t.baseDelay * (1 << uint(attempt))
	return clampAndJitter(backoff)
}

// isRateLimited returns true if the response is a GitHub rate-limit error.
// 429 is always a rate limit. 403 is only a rate limit when
// X-RateLimit-Remaining is "0".
func isRateLimited(resp *http.Response) bool {
	if resp.StatusCode == http.StatusTooManyRequests {
		return true
	}
	if resp.StatusCode == http.StatusForbidden {
		return resp.Header.Get("X-RateLimit-Remaining") == "0"
	}
	return false
}

// parseRetryAfter parses the Retry-After header as integer seconds.
func parseRetryAfter(resp *http.Response) time.Duration {
	v := resp.Header.Get("Retry-After")
	if v == "" {
		return 0
	}
	secs, err := strconv.Atoi(v)
	if err != nil || secs < 0 {
		return 0
	}
	return time.Duration(secs) * time.Second
}

// parseRateLimitReset parses the X-RateLimit-Reset header (Unix epoch
// timestamp) and returns the duration until that time.
func parseRateLimitReset(resp *http.Response) time.Duration {
	v := resp.Header.Get("X-RateLimit-Reset")
	if v == "" {
		return 0
	}
	epoch, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		return 0
	}
	d := time.Until(time.Unix(epoch, 0))
	if d <= 0 {
		return 0
	}
	return d
}

const maxRetryWait = 10 * time.Second

// clampAndJitter adds ±50% jitter and caps the duration at maxRetryWait.
func clampAndJitter(d time.Duration) time.Duration {
	// Jitter: multiply by random factor in [0.5, 1.5)
	jitter := 0.5 + rand.Float64()
	d = time.Duration(float64(d) * jitter)
	if d > maxRetryWait {
		d = maxRetryWait
	}
	if d < 0 {
		d = 0
	}
	return d
}
