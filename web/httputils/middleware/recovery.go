package middleware

import (
	"log"
	"net/http"
)

func RecoveryHandler() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {

			defer func() {
				if err := recover(); err != nil {
					log.Printf("PANIC: %s", err)
					w.WriteHeader(http.StatusInternalServerError)
				}
			}()

			next.ServeHTTP(w, req)
		})
	}
}
