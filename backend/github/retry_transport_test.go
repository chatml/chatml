package github

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newTestTransport(handler http.Handler) (*retryTransport, *httptest.Server) {
	srv := httptest.NewServer(handler)
	return &retryTransport{
		base:       &http.Transport{},
		maxRetries: 3,
		baseDelay:  1 * time.Millisecond, // fast for tests
	}, srv
}

func TestRetryOn429(t *testing.T) {
	var attempts int32
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt32(&attempts, 1)
		if n <= 2 {
			w.WriteHeader(http.StatusTooManyRequests)
			w.Write([]byte("rate limited"))
			return
		}
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("success"))
	})

	rt, srv := newTestTransport(handler)
	defer srv.Close()

	req, _ := http.NewRequestWithContext(context.Background(), "GET", srv.URL+"/test", nil)
	resp, err := rt.RoundTrip(req)
	require.NoError(t, err)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusOK, resp.StatusCode)
	body, _ := io.ReadAll(resp.Body)
	assert.Equal(t, "success", string(body))
	assert.Equal(t, int32(3), atomic.LoadInt32(&attempts))
}

func TestRetryOn403WithRateLimit(t *testing.T) {
	var attempts int32
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt32(&attempts, 1)
		if n == 1 {
			w.Header().Set("X-RateLimit-Remaining", "0")
			w.WriteHeader(http.StatusForbidden)
			w.Write([]byte("rate limited"))
			return
		}
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("success"))
	})

	rt, srv := newTestTransport(handler)
	defer srv.Close()

	req, _ := http.NewRequestWithContext(context.Background(), "GET", srv.URL+"/test", nil)
	resp, err := rt.RoundTrip(req)
	require.NoError(t, err)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusOK, resp.StatusCode)
	assert.Equal(t, int32(2), atomic.LoadInt32(&attempts))
}

func TestNoRetryOn403PermissionDenied(t *testing.T) {
	var attempts int32
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&attempts, 1)
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte("permission denied"))
	})

	rt, srv := newTestTransport(handler)
	defer srv.Close()

	req, _ := http.NewRequestWithContext(context.Background(), "GET", srv.URL+"/test", nil)
	resp, err := rt.RoundTrip(req)
	require.NoError(t, err)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusForbidden, resp.StatusCode)
	assert.Equal(t, int32(1), atomic.LoadInt32(&attempts), "should not retry 403 without rate-limit header")
}

func TestMaxRetriesExhausted(t *testing.T) {
	var attempts int32
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&attempts, 1)
		w.WriteHeader(http.StatusTooManyRequests)
		w.Write([]byte("rate limited"))
	})

	rt, srv := newTestTransport(handler)
	defer srv.Close()

	req, _ := http.NewRequestWithContext(context.Background(), "GET", srv.URL+"/test", nil)
	resp, err := rt.RoundTrip(req)
	require.NoError(t, err)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusTooManyRequests, resp.StatusCode)
	assert.Equal(t, int32(4), atomic.LoadInt32(&attempts), "1 initial + 3 retries")
}

func TestContextCancellation(t *testing.T) {
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Retry-After", "60")
		w.WriteHeader(http.StatusTooManyRequests)
		w.Write([]byte("rate limited"))
	})

	rt, srv := newTestTransport(handler)
	defer srv.Close()

	ctx, cancel := context.WithCancel(context.Background())
	// Cancel after a short delay so the backoff sleep is interrupted.
	go func() {
		time.Sleep(50 * time.Millisecond)
		cancel()
	}()

	req, _ := http.NewRequestWithContext(ctx, "GET", srv.URL+"/test", nil)
	_, err := rt.RoundTrip(req)
	assert.ErrorIs(t, err, context.Canceled)
}

func TestBodyPreservedOnRetry(t *testing.T) {
	var mu sync.Mutex
	var bodies []string
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		mu.Lock()
		bodies = append(bodies, string(b))
		n := len(bodies)
		mu.Unlock()
		if n == 1 {
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		w.WriteHeader(http.StatusOK)
	})

	rt, srv := newTestTransport(handler)
	defer srv.Close()

	body := `{"key":"value"}`
	req, _ := http.NewRequestWithContext(context.Background(), "POST", srv.URL+"/test", bytes.NewReader([]byte(body)))
	resp, err := rt.RoundTrip(req)
	require.NoError(t, err)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusOK, resp.StatusCode)
	mu.Lock()
	defer mu.Unlock()
	require.Len(t, bodies, 2)
	assert.Equal(t, body, bodies[0])
	assert.Equal(t, body, bodies[1])
}

func TestParseRetryAfter(t *testing.T) {
	tests := []struct {
		name     string
		value    string
		expected time.Duration
	}{
		{"valid seconds", "5", 5 * time.Second},
		{"zero", "0", 0},
		{"negative", "-1", 0},
		{"empty", "", 0},
		{"non-numeric", "abc", 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resp := &http.Response{Header: http.Header{}}
			if tt.value != "" {
				resp.Header.Set("Retry-After", tt.value)
			}
			assert.Equal(t, tt.expected, parseRetryAfter(resp))
		})
	}
}

func TestParseRateLimitReset(t *testing.T) {
	// Set reset to 5 seconds from now.
	future := time.Now().Add(5 * time.Second).Unix()
	resp := &http.Response{Header: http.Header{}}
	resp.Header.Set("X-RateLimit-Reset", strconv.FormatInt(future, 10))

	d := parseRateLimitReset(resp)
	// Should be roughly 5 seconds (allow tolerance for test execution).
	assert.InDelta(t, 5*time.Second, d, float64(2*time.Second))

	// Past timestamp returns 0.
	past := time.Now().Add(-10 * time.Second).Unix()
	resp.Header.Set("X-RateLimit-Reset", strconv.FormatInt(past, 10))
	assert.Equal(t, time.Duration(0), parseRateLimitReset(resp))

	// Missing header returns 0.
	resp.Header.Del("X-RateLimit-Reset")
	assert.Equal(t, time.Duration(0), parseRateLimitReset(resp))
}

func TestIsRateLimited(t *testing.T) {
	tests := []struct {
		name     string
		status   int
		headers  map[string]string
		expected bool
	}{
		{"429 always rate limited", 429, nil, true},
		{"403 with remaining 0", 403, map[string]string{"X-RateLimit-Remaining": "0"}, true},
		{"403 without header", 403, nil, false},
		{"403 with remaining > 0", 403, map[string]string{"X-RateLimit-Remaining": "100"}, false},
		{"200 not rate limited", 200, nil, false},
		{"500 not rate limited", 500, nil, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resp := &http.Response{
				StatusCode: tt.status,
				Header:     http.Header{},
			}
			for k, v := range tt.headers {
				resp.Header.Set(k, v)
			}
			assert.Equal(t, tt.expected, isRateLimited(resp))
		})
	}
}

func TestRetryOnNetworkError(t *testing.T) {
	var attempts int32
	transientErr := errors.New("connection reset by peer")

	rt := &retryTransport{
		base: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			n := atomic.AddInt32(&attempts, 1)
			if n <= 2 {
				return nil, transientErr
			}
			return &http.Response{
				StatusCode: http.StatusOK,
				Body:       io.NopCloser(bytes.NewReader([]byte("success"))),
				Header:     http.Header{},
			}, nil
		}),
		maxRetries: 3,
		baseDelay:  1 * time.Millisecond,
	}

	req, _ := http.NewRequestWithContext(context.Background(), "GET", "http://example.com/test", nil)
	resp, err := rt.RoundTrip(req)
	require.NoError(t, err)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusOK, resp.StatusCode)
	assert.Equal(t, int32(3), atomic.LoadInt32(&attempts))
}

func TestNoRetryOnContextCanceledError(t *testing.T) {
	var attempts int32

	rt := &retryTransport{
		base: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			atomic.AddInt32(&attempts, 1)
			return nil, context.Canceled
		}),
		maxRetries: 3,
		baseDelay:  1 * time.Millisecond,
	}

	req, _ := http.NewRequestWithContext(context.Background(), "GET", "http://example.com/test", nil)
	_, err := rt.RoundTrip(req)
	assert.ErrorIs(t, err, context.Canceled)
	assert.Equal(t, int32(1), atomic.LoadInt32(&attempts), "should not retry context.Canceled")
}

func TestRetryAfterHeaderRespected(t *testing.T) {
	var attempts int32
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt32(&attempts, 1)
		if n == 1 {
			w.Header().Set("Retry-After", "1")
			w.WriteHeader(http.StatusTooManyRequests)
			w.Write([]byte("rate limited"))
			return
		}
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("success"))
	})

	rt, srv := newTestTransport(handler)
	defer srv.Close()

	start := time.Now()
	req, _ := http.NewRequestWithContext(context.Background(), "GET", srv.URL+"/test", nil)
	resp, err := rt.RoundTrip(req)
	elapsed := time.Since(start)
	require.NoError(t, err)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusOK, resp.StatusCode)
	assert.Equal(t, int32(2), atomic.LoadInt32(&attempts))
	// Retry-After: 1 with jitter [0.5, 1.5) should wait at least ~500ms.
	assert.Greater(t, elapsed, 400*time.Millisecond, "should respect Retry-After header delay")
}

// roundTripFunc adapts a function to the http.RoundTripper interface.
type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}
