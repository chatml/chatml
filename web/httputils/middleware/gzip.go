package middleware

import (
	"compress/gzip"
	"net/http"
	"strings"
)

// These compression constants are copied from the compress/gzip package.
const (
	encodingGzip = "gzip"

	headerAcceptEncoding  = "Accept-Encoding"
	headerContentEncoding = "Content-Encoding"
	headerContentLength   = "Content-Length"
	headerContentType     = "Content-Type"
	headerVary            = "Vary"
	headerSecWebSocketKey = "Sec-WebSocket-Key"

	BestCompression    = gzip.BestCompression
	BestSpeed          = gzip.BestSpeed
	DefaultCompression = gzip.DefaultCompression
	NoCompression      = gzip.NoCompression
)

/*
Middleware that sends compresses the response with Gzip if supported by the client
*/
func GzipHandler(compressionLevel int) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {

			// Skip compression if the client doesn't accept gzip encoding.
			if !strings.Contains(req.Header.Get(headerAcceptEncoding), encodingGzip) {
				next.ServeHTTP(w, req)
				return
			}

			// Skip compression if client attempt WebSocket connection
			if len(req.Header.Get(headerSecWebSocketKey)) > 0 {
				next.ServeHTTP(w, req)
				return
			}

			// Create new gzip Writer. Skip compression if an invalid compression
			// level was set.
			gz, err := gzip.NewWriterLevel(w, compressionLevel)
			if err != nil {
				next.ServeHTTP(w, req)
				return
			}
			defer gz.Close()

			// Set the appropriate gzip headers.
			headers := w.Header()
			headers.Set(headerContentEncoding, encodingGzip)
			headers.Set(headerVary, headerAcceptEncoding)

			grw := gzipResponseWriter{gz, w}

			// Call the next handler supplying the gzipResponseWriter instead of
			// the original.
			next.ServeHTTP(grw, req)

			// Delete the content length after we know we have been written to.
			grw.Header().Del(headerContentLength)

		})
	}
}

// gzipResponseWriter is the ResponseWriter that negroni.ResponseWriter is
// wrapped in.
type gzipResponseWriter struct {
	w *gzip.Writer
	http.ResponseWriter
}

// Write writes bytes to the gzip.Writer. It will also set the Content-Type
// header using the net/http library content type detection if the Content-Type
// header was not set yet.
func (grw gzipResponseWriter) Write(b []byte) (int, error) {
	if len(grw.Header().Get(headerContentType)) == 0 {
		grw.Header().Set(headerContentType, http.DetectContentType(b))
	}
	return grw.w.Write(b)
}
