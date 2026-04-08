package server

import (
	"bytes"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type testDecodeReq struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

type testDecodeReqValidatable struct {
	Name string `json:"name"`
}

func (r *testDecodeReqValidatable) Validate() error {
	if r.Name == "" {
		return errors.New("name is required")
	}
	return nil
}

func TestDecodeJSON_Success(t *testing.T) {
	body := bytes.NewBufferString(`{"name":"test","count":42}`)
	r := httptest.NewRequest("POST", "/", body)
	w := httptest.NewRecorder()

	result, ok := DecodeJSON[testDecodeReq](w, r)
	require.True(t, ok)
	assert.Equal(t, "test", result.Name)
	assert.Equal(t, 42, result.Count)
}

func TestDecodeJSON_InvalidJSON(t *testing.T) {
	body := bytes.NewBufferString(`{invalid}`)
	r := httptest.NewRequest("POST", "/", body)
	w := httptest.NewRecorder()

	_, ok := DecodeJSON[testDecodeReq](w, r)
	assert.False(t, ok)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestDecodeJSON_EmptyBody(t *testing.T) {
	body := bytes.NewBufferString(``)
	r := httptest.NewRequest("POST", "/", body)
	w := httptest.NewRecorder()

	_, ok := DecodeJSON[testDecodeReq](w, r)
	assert.False(t, ok)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestDecodeJSON_WithValidation_Pass(t *testing.T) {
	body := bytes.NewBufferString(`{"name":"valid"}`)
	r := httptest.NewRequest("POST", "/", body)
	w := httptest.NewRecorder()

	result, ok := DecodeJSON[testDecodeReqValidatable](w, r)
	require.True(t, ok)
	assert.Equal(t, "valid", result.Name)
}

func TestDecodeJSON_WithValidation_Fail(t *testing.T) {
	body := bytes.NewBufferString(`{"name":""}`)
	r := httptest.NewRequest("POST", "/", body)
	w := httptest.NewRecorder()

	_, ok := DecodeJSON[testDecodeReqValidatable](w, r)
	assert.False(t, ok)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestDecodeJSONStrict_RejectsUnknownFields(t *testing.T) {
	body := bytes.NewBufferString(`{"name":"test","unknown_field":"value"}`)
	r := httptest.NewRequest("POST", "/", body)
	w := httptest.NewRecorder()

	_, ok := DecodeJSONStrict[testDecodeReq](w, r)
	assert.False(t, ok)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestDecodeJSON_AllowsUnknownFields(t *testing.T) {
	body := bytes.NewBufferString(`{"name":"test","unknown_field":"value"}`)
	r := httptest.NewRequest("POST", "/", body)
	w := httptest.NewRecorder()

	result, ok := DecodeJSON[testDecodeReq](w, r)
	require.True(t, ok)
	assert.Equal(t, "test", result.Name)
}
