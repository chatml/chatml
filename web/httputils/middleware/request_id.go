package middleware

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
)

const RequestIDHeaderKey = "X-Request-Id"

func RequestIDHandler(size int) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {

			id, err := generateRequestID(size)
			if err == nil {
				req.Header.Set(RequestIDHeaderKey, id)
			}

			next.ServeHTTP(w, req)
		})
	}
}

func generateRequestID(n int) (string, error) {
	r := make([]byte, n)
	_, err := rand.Read(r)
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(r), nil
}
