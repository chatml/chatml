package models

import (
	"code.google.com/p/go.net/websocket"
)

type Connection struct {
	wsConn *websocket.Conn
	User   *OnlineUser
}

func NewConnection(user *User, ws *websocket.Conn) *Connection {

	onlineUser := &OnlineUser{
		InChannel:  runningActiveChannel,
		Connection: ws,
		Send:       make(chan Message, 256),
		UserInfo:   user,
	}
	runningActiveChannel.OnlineUsers[email] = onlineUser

	m := Message{
		MType: STATUS_MTYPE,
		UserStatus: UserStatus{
			Users: runningActiveChannel.GetOnlineUsers(),
		},
	}
	runningActiveChannel.Broadcast <- m

	return connection
}

func (c *Connection) Send(message *Message) error {
	return websocket.JSON.Send(this.wsConn, message)
}

func (c *Connection) Close() error {
	return c.Close()
}

func (c *Connection) run() {

	go c.OnlineUser.PushToClient()

	c.OnlineUser.PullFromClient()
	c.OnlineUser.killUserResource()
}
