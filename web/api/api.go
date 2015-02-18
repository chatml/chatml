package api

import (
	"net/http"

	"github.com/gorilla/mux"

	"github.com/chatml/chatml/util/log"
)

type ApiService struct {
	router *mux.Router
}

func NewApiService() (*ApiService, error) {

	log.V(1).Info("Starting API Service")

	service := &ApiService{
		router: mux.NewRouter(),
	}

	service.registerRoutes()
	return service, nil
}

func (s *ApiService) ServeHTTP(rw http.ResponseWriter, req *http.Request) {
	s.router.ServeHTTP(rw, req)
}

func (s *ApiService) registerEndpoint(method string, pattern string, f http.HandlerFunc) {
	//switch method {
	//case "GET":
	//s.router.HandleFunc(pattern, CompressionHeaderHandler(f)).Methods("GET")
	//case "POST":
	//s.router.HandleFunc(pattern, HeaderHandler(f)).Methods("POST")
	//case "PUT":
	//s.router.HandleFunc(pattern, HeaderHandler(f)).Methods("PUT")
	//case "DELETE":
	//s.router.HandleFunc(pattern, HeaderHandler(f)).Methods("DELETE")
	//}
	//s.router.HandleFunc(pattern, HeaderHandler(s.sendCrossOriginHeader)).Methods("OPTIONS")
}

func (s *ApiService) registerRoutes() {

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

func (s *ApiService) handleAccountVerify(rw http.ResponseWriter, req *http.Request) {
	rw.WriteHeader(http.StatusOK)
	rw.Write([]byte("accountVerify goes here"))
}

func (s *ApiService) handleAccountSetup(rw http.ResponseWriter, req *http.Request) {
	rw.WriteHeader(http.StatusOK)
	rw.Write([]byte("accountSetup goes here"))
}

func (s *ApiService) handleDeviceRegistration(rw http.ResponseWriter, req *http.Request) {
	rw.WriteHeader(http.StatusOK)
	rw.Write([]byte("handleDeviceRegistration goes here"))
}

func (s *ApiService) listConversations(rw http.ResponseWriter, req *http.Request) {
	rw.WriteHeader(http.StatusOK)
	rw.Write([]byte("listChannels goes here"))
}

func (s *ApiService) createConversation(rw http.ResponseWriter, req *http.Request) {
	rw.WriteHeader(http.StatusOK)
	rw.Write([]byte("createChannel goes here"))
}

func (s *ApiService) showConversation(rw http.ResponseWriter, req *http.Request) {
	rw.WriteHeader(http.StatusOK)
	rw.Write([]byte("getChannel goes here"))
}

func (s *ApiService) updateConversation(rw http.ResponseWriter, req *http.Request) {
	rw.WriteHeader(http.StatusOK)
	rw.Write([]byte("updateChannel goes here"))
}

func (s *ApiService) joinConversation(rw http.ResponseWriter, req *http.Request) {
	rw.WriteHeader(http.StatusOK)
	rw.Write([]byte("joinChannel goes here"))
}

func (s *ApiService) leaveConversation(rw http.ResponseWriter, req *http.Request) {
	rw.WriteHeader(http.StatusOK)
	rw.Write([]byte("leaveChannel goes here"))
}

func (s *ApiService) listMessages(rw http.ResponseWriter, req *http.Request) {
	rw.WriteHeader(http.StatusOK)
	rw.Write([]byte("listMessages goes here"))
}

func (s *ApiService) postMessage(rw http.ResponseWriter, req *http.Request) {
	rw.WriteHeader(http.StatusOK)
	rw.Write([]byte("postMessage goes here"))
}

func (s *ApiService) showMessage(rw http.ResponseWriter, req *http.Request) {
	rw.WriteHeader(http.StatusOK)
	rw.Write([]byte("showMessage goes here"))
}

func (s *ApiService) updateMessage(rw http.ResponseWriter, req *http.Request) {
	rw.WriteHeader(http.StatusOK)
	rw.Write([]byte("updateMessage goes here"))
}

func (s *ApiService) deleteMessage(rw http.ResponseWriter, req *http.Request) {
	rw.WriteHeader(http.StatusOK)
	rw.Write([]byte("deleteMessage goes here"))
}

func (s *ApiService) listAttachments(rw http.ResponseWriter, req *http.Request) {
	rw.WriteHeader(http.StatusOK)
	rw.Write([]byte("listAttachments goes here"))
}

func (s *ApiService) postAttachment(rw http.ResponseWriter, req *http.Request) {
	rw.WriteHeader(http.StatusOK)
	rw.Write([]byte("postAttachment goes here"))
}

func (s *ApiService) showAttachment(rw http.ResponseWriter, req *http.Request) {
	rw.WriteHeader(http.StatusOK)
	rw.Write([]byte("showAttachment goes here"))
}

func (s *ApiService) postLocation(rw http.ResponseWriter, req *http.Request) {
	rw.WriteHeader(http.StatusOK)
	rw.Write([]byte("postLocation goes here"))
}

func (s *ApiService) deleteAttachment(rw http.ResponseWriter, req *http.Request) {
	rw.WriteHeader(http.StatusOK)
	rw.Write([]byte("deleteAttachment goes here"))
}

func (s *ApiService) renderImage(rw http.ResponseWriter, req *http.Request) {
	rw.WriteHeader(http.StatusOK)
	rw.Write([]byte("renderImage goes here"))
}

func (s *ApiService) listRecipients(rw http.ResponseWriter, req *http.Request) {
	rw.WriteHeader(http.StatusOK)
	rw.Write([]byte("listRecipients goes here"))
}

func (s *ApiService) addRecipients(rw http.ResponseWriter, req *http.Request) {
	rw.WriteHeader(http.StatusOK)
	rw.Write([]byte("addRecipients goes here"))
}

func (s *ApiService) removeRecipients(rw http.ResponseWriter, req *http.Request) {
	rw.WriteHeader(http.StatusOK)
	rw.Write([]byte("renderImage goes here"))
}

func (s *ApiService) listGroups(rw http.ResponseWriter, req *http.Request) {
	rw.WriteHeader(http.StatusOK)
	rw.Write([]byte("listGroups goes here"))
}

func (s *ApiService) showRecipient(rw http.ResponseWriter, req *http.Request) {
	rw.WriteHeader(http.StatusOK)
	rw.Write([]byte("showRecipient goes here"))
}
