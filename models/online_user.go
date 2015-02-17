package models

import "code.google.com/p/go.net/websocket"

const (
	TEXT_MTYPE   = "text_mtype"
	STATUS_MTYPE = "status_mtype"
	TIME_FORMAT  = "01-02 15:04:05"
)

type OnlineUser struct {
	InChannel  *Channel
	Connection *Connection
	UserInfo   *User
	Send       chan Message
}

func (o *OnlineUser) PullFromClient() {
	for {
		var content string
		err := websocket.Message.Receive(o.Connection, &content)
		// If user closes or refreshes the browser, a err will occur
		if err != nil {
			return
		}

		m := Message{
			MType: TEXT_MTYPE,
			TextMessage: TextMessage{
				UserInfo: o.UserInfo,
				Time:     humanCreatedAt(),
				Content:  content,
			},
		}
		o.InChannel.Broadcast <- m
	}
}

func (o *OnlineUser) PushToClient() {
	for b := range o.Send {
		err := o.Connection.Send(b)
		if err != nil {
			break
		}
	}
}

// private methods

func (o *OnlineUser) killUserResource() {
	o.Connection.Close()
	delete(o.InChannel.OnlineUsers, o.UserInfo.Email)
	close(o.Send)

	m := Message{
		MType: STATUS_MTYPE,
		UserStatus: UserStatus{
			Users: runningActiveRoom.GetOnlineUsers(),
		},
	}
	runningActiveRoom.Broadcast <- m
}
