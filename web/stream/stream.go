package stream

import (
	"net/http"

	"github.com/googollee/go-socket.io"

	"github.com/chatml/chatml/config"
	"github.com/chatml/chatml/util/log"
)

type StreamService struct {
	Config *config.Config
	sio    *socketio.Server
}

func NewStreamService() (*StreamService, error) {
	log.V(1).Info("Starting Stream Server")

	sioServer, err := socketio.NewServer(nil)
	if err != nil {
		log.Fatalf("Failed to create Stream Service: %s", err)
		return nil, err
	}

	service := &StreamService{
		sio: sioServer,
	}

	service.registerEvents()

	return service, nil
}

func (s *StreamService) ServeHTTP(rw http.ResponseWriter, req *http.Request) {
	s.sio.ServeHTTP(rw, req)
}

func (s *StreamService) registerEvents() {
	s.sio.SetCookie("chatml")
	s.sio.On("connection", s.handleOnConnection)
	s.sio.On("disconnection", s.handleOnDisconnection)
	s.sio.On("error", s.handleOnError)
}

func (s *StreamService) handleOnConnection(socket socketio.Socket) {
	log.Infof("StreamService connected: %s", socket.Id())
}

func (s *StreamService) handleOnDisconnection(socket socketio.Socket) {
	log.Infof("StreamService disconnect: %s", socket.Id())
}

func (s *StreamService) handleOnError(socket socketio.Socket, err error) {
	log.Errorf("StreamService Error: %s", err)
}

func (s *StreamService) Close() {
}
