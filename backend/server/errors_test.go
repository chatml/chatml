package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWriteError(t *testing.T) {
	w := httptest.NewRecorder()
	writeError(w, http.StatusBadRequest, ErrCodeValidation, "invalid input", nil)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status %d, got %d", http.StatusBadRequest, w.Code)
	}

	contentType := w.Header().Get("Content-Type")
	if contentType != "application/json" {
		t.Errorf("expected Content-Type application/json, got %s", contentType)
	}

	var apiErr APIError
	if err := json.Unmarshal(w.Body.Bytes(), &apiErr); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}

	if apiErr.Error != "invalid input" {
		t.Errorf("expected error 'invalid input', got %q", apiErr.Error)
	}
	if apiErr.Code != ErrCodeValidation {
		t.Errorf("expected code %s, got %s", ErrCodeValidation, apiErr.Code)
	}
}

func TestWriteValidationError(t *testing.T) {
	w := httptest.NewRecorder()
	writeValidationError(w, "field is required")

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status %d, got %d", http.StatusBadRequest, w.Code)
	}

	var apiErr APIError
	if err := json.Unmarshal(w.Body.Bytes(), &apiErr); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}

	if apiErr.Code != ErrCodeValidation {
		t.Errorf("expected code %s, got %s", ErrCodeValidation, apiErr.Code)
	}
	if apiErr.Error != "field is required" {
		t.Errorf("expected error 'field is required', got %q", apiErr.Error)
	}
}

func TestWriteNotFound(t *testing.T) {
	w := httptest.NewRecorder()
	writeNotFound(w, "session")

	if w.Code != http.StatusNotFound {
		t.Errorf("expected status %d, got %d", http.StatusNotFound, w.Code)
	}

	var apiErr APIError
	if err := json.Unmarshal(w.Body.Bytes(), &apiErr); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}

	if apiErr.Code != ErrCodeNotFound {
		t.Errorf("expected code %s, got %s", ErrCodeNotFound, apiErr.Code)
	}
	if apiErr.Error != "session not found" {
		t.Errorf("expected error 'session not found', got %q", apiErr.Error)
	}
}

func TestWriteConflict(t *testing.T) {
	w := httptest.NewRecorder()
	writeConflict(w, "resource already exists")

	if w.Code != http.StatusConflict {
		t.Errorf("expected status %d, got %d", http.StatusConflict, w.Code)
	}

	var apiErr APIError
	if err := json.Unmarshal(w.Body.Bytes(), &apiErr); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}

	if apiErr.Code != ErrCodeConflict {
		t.Errorf("expected code %s, got %s", ErrCodeConflict, apiErr.Code)
	}
}

func TestWriteDBError(t *testing.T) {
	w := httptest.NewRecorder()
	internalErr := errors.New("SQLITE_CONSTRAINT: UNIQUE constraint failed: users.email")
	writeDBError(w, internalErr)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected status %d, got %d", http.StatusInternalServerError, w.Code)
	}

	var apiErr APIError
	if err := json.Unmarshal(w.Body.Bytes(), &apiErr); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}

	if apiErr.Code != ErrCodeInternal {
		t.Errorf("expected code %s, got %s", ErrCodeInternal, apiErr.Code)
	}
	if apiErr.Error != "a database error occurred" {
		t.Errorf("expected generic message, got %q", apiErr.Error)
	}

	// Verify internal error is NOT exposed in response
	body := w.Body.String()
	if strings.Contains(body, "SQLITE") || strings.Contains(body, "UNIQUE") {
		t.Errorf("internal error details exposed in response: %s", body)
	}
}

func TestWriteInternalError(t *testing.T) {
	w := httptest.NewRecorder()
	internalErr := errors.New("failed to read /Users/john/secret/config.json: permission denied")
	writeInternalError(w, "failed to process request", internalErr)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected status %d, got %d", http.StatusInternalServerError, w.Code)
	}

	var apiErr APIError
	if err := json.Unmarshal(w.Body.Bytes(), &apiErr); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}

	if apiErr.Error != "failed to process request" {
		t.Errorf("expected custom message, got %q", apiErr.Error)
	}

	// Verify internal error is NOT exposed in response
	body := w.Body.String()
	if strings.Contains(body, "/Users") || strings.Contains(body, "permission denied") {
		t.Errorf("internal error details exposed in response: %s", body)
	}
}

func TestWriteUnauthorized(t *testing.T) {
	w := httptest.NewRecorder()
	writeUnauthorized(w, "invalid token")

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected status %d, got %d", http.StatusUnauthorized, w.Code)
	}

	var apiErr APIError
	if err := json.Unmarshal(w.Body.Bytes(), &apiErr); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}

	if apiErr.Code != ErrCodeUnauthorized {
		t.Errorf("expected code %s, got %s", ErrCodeUnauthorized, apiErr.Code)
	}
}

func TestWriteBadGateway(t *testing.T) {
	w := httptest.NewRecorder()
	internalErr := errors.New("connection refused to api.github.com:443")
	writeBadGateway(w, "failed to connect to GitHub", internalErr)

	if w.Code != http.StatusBadGateway {
		t.Errorf("expected status %d, got %d", http.StatusBadGateway, w.Code)
	}

	var apiErr APIError
	if err := json.Unmarshal(w.Body.Bytes(), &apiErr); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}

	if apiErr.Code != ErrCodeBadGateway {
		t.Errorf("expected code %s, got %s", ErrCodeBadGateway, apiErr.Code)
	}
	if apiErr.Error != "failed to connect to GitHub" {
		t.Errorf("expected custom message, got %q", apiErr.Error)
	}

	// Verify internal error is NOT exposed in response
	body := w.Body.String()
	if strings.Contains(body, "connection refused") || strings.Contains(body, "443") {
		t.Errorf("internal error details exposed in response: %s", body)
	}
}

func TestErrorsDoNotExposeFilePaths(t *testing.T) {
	testCases := []struct {
		name        string
		internalErr error
	}{
		{
			name:        "absolute path",
			internalErr: errors.New("open /Users/admin/app/config.json: no such file"),
		},
		{
			name:        "home directory path",
			internalErr: errors.New("failed to read ~/.ssh/id_rsa: permission denied"),
		},
		{
			name:        "windows-style path",
			internalErr: errors.New("open C:\\Users\\admin\\secrets.txt: access denied"),
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			writeInternalError(w, "operation failed", tc.internalErr)

			body := w.Body.String()

			// Check for common path patterns that should NOT appear
			pathIndicators := []string{"/Users", "/home", "C:\\", "~/.ssh", ".json", ".txt", "permission denied", "no such file", "access denied"}
			for _, indicator := range pathIndicators {
				if strings.Contains(body, indicator) {
					t.Errorf("response contains path indicator %q: %s", indicator, body)
				}
			}
		})
	}
}

func TestErrorsDoNotExposeSQLDetails(t *testing.T) {
	testCases := []struct {
		name        string
		internalErr error
	}{
		{
			name:        "unique constraint",
			internalErr: errors.New("SQLITE_CONSTRAINT: UNIQUE constraint failed: sessions.id"),
		},
		{
			name:        "foreign key constraint",
			internalErr: errors.New("FOREIGN KEY constraint failed"),
		},
		{
			name:        "table not found",
			internalErr: errors.New("no such table: users"),
		},
		{
			name:        "column not found",
			internalErr: errors.New("no such column: password_hash"),
		},
		{
			name:        "database locked",
			internalErr: errors.New("database is locked"),
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			writeDBError(w, tc.internalErr)

			body := w.Body.String()

			// Check for SQL-related terms that should NOT appear
			sqlIndicators := []string{"SQLITE", "UNIQUE", "FOREIGN KEY", "no such table", "no such column", "database is locked", "constraint"}
			for _, indicator := range sqlIndicators {
				if strings.Contains(body, indicator) {
					t.Errorf("response contains SQL indicator %q: %s", indicator, body)
				}
			}
		})
	}
}
