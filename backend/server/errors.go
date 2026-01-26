package server

import (
	"encoding/json"
	"net/http"

	"github.com/chatml/chatml-backend/logger"
)

// APIError represents a structured error response
type APIError struct {
	Error string `json:"error"`
	Code  string `json:"code"`
}

// Error codes for categorization
const (
	ErrCodeValidation      = "VALIDATION_ERROR"
	ErrCodeNotFound        = "NOT_FOUND"
	ErrCodeConflict        = "CONFLICT"
	ErrCodeInternal        = "INTERNAL_ERROR"
	ErrCodeUnauthorized    = "UNAUTHORIZED"
	ErrCodeBadGateway      = "BAD_GATEWAY"
	ErrCodePayloadTooLarge = "PAYLOAD_TOO_LARGE"
)

// writeError writes a JSON error response and logs the internal error server-side
func writeError(w http.ResponseWriter, status int, code string, userMsg string, internalErr error) {
	if internalErr != nil {
		logger.Error.Errorf("code=%s status=%d msg=%q internal_err=%v", code, status, userMsg, internalErr)
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(APIError{
		Error: userMsg,
		Code:  code,
	}); err != nil {
		logger.Error.Errorf("Failed to encode error response: %v", err)
	}
}

// writeValidationError writes a 400 validation error response
func writeValidationError(w http.ResponseWriter, msg string) {
	writeError(w, http.StatusBadRequest, ErrCodeValidation, msg, nil)
}

// writeNotFound writes a 404 not found error response
func writeNotFound(w http.ResponseWriter, resource string) {
	writeError(w, http.StatusNotFound, ErrCodeNotFound, resource+" not found", nil)
}

// writeConflict writes a 409 conflict error response
func writeConflict(w http.ResponseWriter, msg string) {
	writeError(w, http.StatusConflict, ErrCodeConflict, msg, nil)
}

// writeDBError writes a 500 error for database failures, logging the internal error
func writeDBError(w http.ResponseWriter, err error) {
	writeError(w, http.StatusInternalServerError, ErrCodeInternal, "a database error occurred", err)
}

// writeInternalError writes a 500 error with a custom message, logging the internal error
func writeInternalError(w http.ResponseWriter, msg string, err error) {
	writeError(w, http.StatusInternalServerError, ErrCodeInternal, msg, err)
}

// writeUnauthorized writes a 401 unauthorized error response
func writeUnauthorized(w http.ResponseWriter, msg string) {
	writeError(w, http.StatusUnauthorized, ErrCodeUnauthorized, msg, nil)
}

// writeBadGateway writes a 502 bad gateway error response for external service failures
func writeBadGateway(w http.ResponseWriter, msg string, err error) {
	writeError(w, http.StatusBadGateway, ErrCodeBadGateway, msg, err)
}

// writePayloadTooLarge writes a 413 payload too large error response
func writePayloadTooLarge(w http.ResponseWriter, msg string) {
	writeError(w, http.StatusRequestEntityTooLarge, ErrCodePayloadTooLarge, msg, nil)
}
