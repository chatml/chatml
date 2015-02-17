package models

import (
	"fmt"
	"time"
)

type Message struct {
	ChannelId string
	CreatedBy string
	CreatedAt time.Time
	PlainText string
	Html      string
}

func (m *Message) ContainsLink() bool {
	return false
}

func (m *Message) String() {
	return fmt.SPrintf("Message: %v", m.PlainText)
}

// private methods

func (m *Message) validate() bool {
	return true
}
