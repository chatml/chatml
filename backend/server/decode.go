package server

import (
	"encoding/json"
	"net/http"
)

// Validatable is implemented by request structs that can self-validate.
type Validatable interface {
	Validate() error
}

// DecodeJSON reads the request body as JSON into a new value of type T.
// If the struct implements Validatable, it runs validation automatically.
// Returns the decoded value and true on success.
// On failure, writes an error response and returns zero value and false.
func DecodeJSON[T any](w http.ResponseWriter, r *http.Request) (T, bool) {
	var dst T
	if err := json.NewDecoder(r.Body).Decode(&dst); err != nil {
		writeValidationError(w, "invalid request body")
		return dst, false
	}
	if v, ok := any(&dst).(Validatable); ok {
		if err := v.Validate(); err != nil {
			writeValidationError(w, err.Error())
			return dst, false
		}
	}
	return dst, true
}

// DecodeJSONStrict is like DecodeJSON but rejects unknown fields.
func DecodeJSONStrict[T any](w http.ResponseWriter, r *http.Request) (T, bool) {
	var dst T
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&dst); err != nil {
		writeValidationError(w, "invalid request body")
		return dst, false
	}
	if v, ok := any(&dst).(Validatable); ok {
		if err := v.Validate(); err != nil {
			writeValidationError(w, err.Error())
			return dst, false
		}
	}
	return dst, true
}
