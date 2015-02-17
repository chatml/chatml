package httputils

import "net/http"

func HeaderHandler(handler http.HandlerFunc) http.HandlerFunc {
	return func(rw http.ResponseWriter, req *http.Request) {
		rw.Header().Add("Access-Control-Allow-Origin", "*")
		rw.Header().Add("Access-Control-Max-Age", "2592000")
		rw.Header().Add("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE")
		rw.Header().Add("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept")
		handler(rw, req)
	}
}
