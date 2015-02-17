package util

import (
	"fmt"
	"testing"
	"time"
)

func TestRetry(t *testing.T) {
	opts := RetryOptions{"test", time.Microsecond * 10, time.Second, 2, 10}
	var retries int
	err := RetryWithBackoff(opts, func() (bool, error) {
		retries++
		if retries >= 3 {
			return true, nil
		}
		return false, nil
	})
	if err != nil || retries != 3 {
		t.Error("expected 3 retries, got", retries, ":", err)
	}
}

func TestRetryExceedsMaxBackoff(t *testing.T) {
	timer := time.AfterFunc(time.Second, func() {
		t.Error("max backoff not respected")
	})
	opts := RetryOptions{"test", time.Microsecond * 10, time.Microsecond * 10, 1000, 3}
	err := RetryWithBackoff(opts, func() (bool, error) {
		return false, nil
	})
	if err == nil {
		t.Error("should receive max attempts error on retry")
	}
	timer.Stop()
}

func TestRetryExceedsMaxAttempts(t *testing.T) {
	var retries int
	opts := RetryOptions{"test", time.Microsecond * 10, time.Second, 2, 3}
	err := RetryWithBackoff(opts, func() (bool, error) {
		retries++
		return false, nil
	})
	if err == nil || retries != 3 {
		t.Error("expected 3 retries, got", retries, ":", err)
	}
}

func TestRetryFunctionReturnsError(t *testing.T) {
	opts := RetryOptions{"test", time.Microsecond * 10, time.Second, 2, 0 /* indefinite */}
	err := RetryWithBackoff(opts, func() (bool, error) {
		return false, fmt.Errorf("something went wrong")
	})
	if err == nil {
		t.Error("expected an error")
	}
}
