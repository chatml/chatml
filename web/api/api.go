package api

import (
	"net/http"

	"github.com/gorilla/mux"
)

type ApiService struct {
	router *mux.Router
}

func NewApiService() *ApiService {

	log.V(1).Info("Starting API Service")

	service := &ApiService{
		router: mux.NewRouter(),
	}

	service.registerRoutes()
	return service
}

func (s *ApiServer) ServeHTTP(rw http.ResponseWriter, req *http.Request) {
	s.router.ServeHTTP(rw, req)
}

func (s *ApiServer) registerEndpoint(method string, pattern string, f http.HandlerFunc) {
	switch method {
	case "GET":
		s.router.HandleFunc(pattern, CompressionHeaderHandler(f)).Methods("GET")
	case "POST":
		s.router.HandleFunc(pattern, HeaderHandler(f)).Methods("POST")
	case "PUT":
		s.router.HandleFunc(pattern, HeaderHandler(f)).Methods("PUT")
	case "DELETE":
		s.router.HandleFunc(pattern, HeaderHandler(f)).Methods("DELETE")
	}
	s.router.HandleFunc(pattern, HeaderHandler(s.sendCrossOriginHeader)).Methods("OPTIONS")
}

func (s *ApiServer) registerRoutes() {

	s.registerEndpoint("POST", "/api/v1/account/verify", s.handleAccountVerify)
	s.registerEndpoint("POST", "/api/v1/account/setup", s.handleAccountSetup)

	s.registerEndpoint("POST", "/api/v1/device/register", s.handleDeviceRegistration)

	s.registerEndpoint("GET", "/api/v1/conversations", s.listConversations)
	s.registerEndpoint("POST", "/api/v1/conversations", s.createConversation)

	s.registerEndpoint("GET", "/api/v1/conversations/{conversation}", s.showConversation)
	s.registerEndpoint("PUT", "/api/v1/conversations/{conversation}", s.updateConversation)
	s.registerEndpoint("POST", "/api/v1/conversations/{conversation}", s.joinConversation)
	s.registerEndpoint("DELETE", "/api/v1/conversations/{conversation}", s.leaveConversation)

	s.registerEndpoint("GET", "/api/v1/conversations/{conversation}/messages", s.listMessages)
	s.registerEndpoint("POST", "/api/v1/conversations/{conversation}/messages", s.postMessage)
	s.registerEndpoint("GET", "/api/v1/conversations/{conversation}/messages/{message_id}", s.showMessage)
	s.registerEndpoint("PUT", "/api/v1/conversations/{conversation}/messages/{message_id}", s.updateMessage)
	s.registerEndpoint("DELETE", "/api/v1/conversations/{conversation}/messages/{message_id}", s.deleteMessage)

	s.registerEndpoint("GET", "/api/v1/conversations/{conversation}/attachments", s.listAttachments)
	s.registerEndpoint("POST", "/api/v1/conversations/{conversation}/attachments", s.postAttachment)
	s.registerEndpoint("GET", "/api/v1/conversations/{conversation}/attachments/{attachment_id}", s.showAttachment)
	s.registerEndpoint("DELETE", "/api/v1/conversations/{conversation}/attachments/{attachment_id}", s.deleteAttachment)

	s.registerEndpoint("POST", "/api/v1/conversations/{conversation}/location", s.postLocation)

	s.registerEndpoint("GET", "/api/v1/conversations/{conversation}/images/{attachment_id}", s.renderImage)

	s.registerEndpoint("GET", "/api/v1/conversations/{conversation}/recipients", s.listRecipients)
	s.registerEndpoint("POST", "/api/v1/conversations/{conversation}/recipients", s.addRecipients)
	s.registerEndpoint("DELETE", "/api/v1/conversations/{conversation}/recipients", s.removeRecipients)

	s.registerEndpoint("GET", "/api/v1/groups", s.listGroups)
	s.registerEndpoint("GET", "/api/v1/recipients", s.listRecipients)
	s.registerEndpoint("GET", "/api/v1/recipients/{recipient}", s.showRecipient)

	http.Handle("/", s.router)

}

func (s *ApiServer) handleAccountVerify(rw http.ResponseWriter, req *http.Request) {
	rw.WriteHeader(http.StatusOK)
	rw.Write([]byte("accountVerify goes here"))
}

func (s *ApiServer) handleAccountSetup(rw http.ResponseWriter, req *http.Request) {
	rw.WriteHeader(http.StatusOK)
	rw.Write([]byte("accountSetup goes here"))
}

func (s *ApiServer) handleDeviceRegistration(rw http.ResponseWriter, req *http.Request) {
	rw.WriteHeader(http.StatusOK)
	rw.Write([]byte("handleDeviceRegistration goes here"))
}

func (s *ApiServer) listConversations(rw http.ResponseWriter, req *http.Request) {
	rw.WriteHeader(http.StatusOK)
	rw.Write([]byte("listChannels goes here"))
}

func (s *ApiServer) createConversation(rw http.ResponseWriter, req *http.Request) {
	rw.WriteHeader(http.StatusOK)
	rw.Write([]byte("createChannel goes here"))
}

func (s *ApiServer) showConversation(rw http.ResponseWriter, req *http.Request) {
	rw.WriteHeader(http.StatusOK)
	rw.Write([]byte("getChannel goes here"))
}

func (s *ApiServer) updateConversation(rw http.ResponseWriter, req *http.Request) {
	rw.WriteHeader(http.StatusOK)
	rw.Write([]byte("updateChannel goes here"))
}

func (s *ApiServer) joinConversation(rw http.ResponseWriter, req *http.Request) {
	rw.WriteHeader(http.StatusOK)
	rw.Write([]byte("joinChannel goes here"))
}

func (s *ApiServer) leaveConversation(rw http.ResponseWriter, req *http.Request) {
	rw.WriteHeader(http.StatusOK)
	rw.Write([]byte("leaveChannel goes here"))
}

func (s *ApiServer) listMessages(rw http.ResponseWriter, req *http.Request) {
	rw.WriteHeader(http.StatusOK)
	rw.Write([]byte("listMessages goes here"))
}

func (s *ApiServer) postMessage(rw http.ResponseWriter, req *http.Request) {
	rw.WriteHeader(http.StatusOK)
	rw.Write([]byte("postMessage goes here"))
}

func (s *ApiServer) showMessage(rw http.ResponseWriter, req *http.Request) {
	rw.WriteHeader(http.StatusOK)
	rw.Write([]byte("showMessage goes here"))
}

func (s *ApiServer) updateMessage(rw http.ResponseWriter, req *http.Request) {
	rw.WriteHeader(http.StatusOK)
	rw.Write([]byte("updateMessage goes here"))
}

func (s *ApiServer) deleteMessage(rw http.ResponseWriter, req *http.Request) {
	rw.WriteHeader(http.StatusOK)
	rw.Write([]byte("deleteMessage goes here"))
}

func (s *ApiServer) listAttachments(rw http.ResponseWriter, req *http.Request) {
	rw.WriteHeader(http.StatusOK)
	rw.Write([]byte("listAttachments goes here"))
}

func (s *ApiServer) postAttachment(rw http.ResponseWriter, req *http.Request) {
	rw.WriteHeader(http.StatusOK)
	rw.Write([]byte("postAttachment goes here"))
}

func (s *ApiServer) showAttachment(rw http.ResponseWriter, req *http.Request) {
	rw.WriteHeader(http.StatusOK)
	rw.Write([]byte("showAttachment goes here"))
}

func (s *ApiServer) postLocation(rw http.ResponseWriter, req *http.Request) {
	rw.WriteHeader(http.StatusOK)
	rw.Write([]byte("postLocation goes here"))
}

func (s *ApiServer) deleteAttachment(rw http.ResponseWriter, req *http.Request) {
	rw.WriteHeader(http.StatusOK)
	rw.Write([]byte("deleteAttachment goes here"))
}

func (s *ApiServer) renderImage(rw http.ResponseWriter, req *http.Request) {
	rw.WriteHeader(http.StatusOK)
	rw.Write([]byte("renderImage goes here"))
}

func (s *ApiServer) listRecipients(rw http.ResponseWriter, req *http.Request) {
	rw.WriteHeader(http.StatusOK)
	rw.Write([]byte("listRecipients goes here"))
}

func (s *ApiServer) addRecipients(rw http.ResponseWriter, req *http.Request) {
	rw.WriteHeader(http.StatusOK)
	rw.Write([]byte("addRecipients goes here"))
}

func (s *ApiServer) removeRecipients(rw http.ResponseWriter, req *http.Request) {
	rw.WriteHeader(http.StatusOK)
	rw.Write([]byte("renderImage goes here"))
}

func (s *ApiServer) listGroups(rw http.ResponseWriter, req *http.Request) {
	rw.WriteHeader(http.StatusOK)
	rw.Write([]byte("listGroups goes here"))
}

func (s *ApiServer) showRecipient(rw http.ResponseWriter, req *http.Request) {
	rw.WriteHeader(http.StatusOK)
	rw.Write([]byte("showRecipient goes here"))
}
