package api

import (
	"net/http"

	"github.com/chatml/chatml/config"
	"github.com/chatml/chatml/util/log"
)

type ApiService struct {
	Config *config.Config
}

func NewApiService(config *config.Config) (*ApiService, error) {

	log.V(1).Info("Starting API Service")

	service := &ApiService{
		Config: config,
	}

	return service, nil
}

func (s *ApiService) route(method string, pattern string, f http.HandlerFunc) {
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

func (s *ApiService) RegisterRoutes() {

	s.route("POST", "/api/v1/account/verify", s.handleAccountVerify)
	s.route("POST", "/api/v1/account/setup", s.handleAccountSetup)

	s.route("POST", "/api/v1/device/register", s.handleDeviceRegistration)

	s.route("GET", "/api/v1/conversations", s.listConversations)
	s.route("POST", "/api/v1/conversations", s.createConversation)

	s.route("GET", "/api/v1/conversations/{conversation}", s.showConversation)
	s.route("PUT", "/api/v1/conversations/{conversation}", s.updateConversation)
	s.route("POST", "/api/v1/conversations/{conversation}", s.joinConversation)
	s.route("DELETE", "/api/v1/conversations/{conversation}", s.leaveConversation)

	s.route("GET", "/api/v1/conversations/{conversation}/messages", s.listMessages)
	s.route("POST", "/api/v1/conversations/{conversation}/messages", s.postMessage)
	s.route("GET", "/api/v1/conversations/{conversation}/messages/{message_id}", s.showMessage)
	s.route("PUT", "/api/v1/conversations/{conversation}/messages/{message_id}", s.updateMessage)
	s.route("DELETE", "/api/v1/conversations/{conversation}/messages/{message_id}", s.deleteMessage)

	s.route("GET", "/api/v1/conversations/{conversation}/attachments", s.listAttachments)
	s.route("POST", "/api/v1/conversations/{conversation}/attachments", s.postAttachment)
	s.route("GET", "/api/v1/conversations/{conversation}/attachments/{attachment_id}", s.showAttachment)
	s.route("DELETE", "/api/v1/conversations/{conversation}/attachments/{attachment_id}", s.deleteAttachment)

	s.route("POST", "/api/v1/conversations/{conversation}/location", s.postLocation)

	s.route("GET", "/api/v1/conversations/{conversation}/images/{attachment_id}", s.renderImage)

	s.route("GET", "/api/v1/conversations/{conversation}/recipients", s.listRecipients)
	s.route("POST", "/api/v1/conversations/{conversation}/recipients", s.addRecipients)
	s.route("DELETE", "/api/v1/conversations/{conversation}/recipients", s.removeRecipients)

	s.route("GET", "/api/v1/groups", s.listGroups)
	s.route("GET", "/api/v1/recipients", s.listRecipients)
	s.route("GET", "/api/v1/recipients/{recipient}", s.showRecipient)

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
