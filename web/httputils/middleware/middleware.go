package middleware

import "net/http"

var (
	emptyHandler = http.Handler(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {}))
)

type MiddlewareFunc func(http.Handler) http.Handler

type Middleware struct {
	Chain []MiddlewareFunc
}

func New() *Middleware {
	return &Middleware{}
}

func (m *Middleware) Use(handler func(http.Handler) http.Handler) {
	m.Chain = append(m.Chain, handler)
}

func (m *Middleware) UseHandler(handler http.Handler) {
	f := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			handler.ServeHTTP(w, req)
			next.ServeHTTP(w, req)
		})
	}
	m.Use(f)
}

func (m *Middleware) Handler() http.Handler {
	//Initialize with an empty http.Handler
	next := emptyHandler

	//Call the middleware stack in FIFO order
	for i := len(m.Chain) - 1; i >= 0; i-- {
		next = m.Chain[i](next)
	}
	return next
}
