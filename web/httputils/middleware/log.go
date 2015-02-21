package middleware

import (
	"log"
	"net/http"
	"time"
)

func LogHandler() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {

			log.Printf("%s %s %s", req.RemoteAddr, req.Method, req.URL)
			next.ServeHTTP(w, req)

		})
	}
}

func LogWithTimingHandler() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {

			defer func(started time.Time) {
				timing := time.Since(started).Nanoseconds() / 1000.0
				log.Printf("%s: %s (%dus)\n", req.Method, req.RequestURI, timing)
			}(time.Now())

			next.ServeHTTP(w, req)
		})
	}
}
