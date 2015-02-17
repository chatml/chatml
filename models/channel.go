package models

import (
	"fmt"
	"time"
)

type ChannelType int

const (
	PairChannel ChannelType = iota
	MultiChannel
	GroupChannel
)

type Channel struct {
	Name         string
	ChannelType  ChannelType
	MessageCount uint64
	Hidden       bool
	Active       bool
	Private      bool
	PulsedAt     time.Time
	CreatedAt    time.Time
	UpdatedAt    time.Time

	RecentMessages []*Message
	OnlineUsers    map[string]*OnlineUser
	Broadcast      chan Message
	CloseSign      chan bool
}

func NewChannel() *Channel {
	channel = &Channel{
		OnlineUsers: make(map[string]*OnlineUser),
		Broadcast:   make(chan Message),
		CloseSign:   make(chan bool),
	}
	go channel.run()
	return channel
}

func (c *Channel) GetOnlineUsers() (users []*User) {
	for _, online := range c.OnlineUsers {
		users = append(users, online.UserInfo)
	}
	return
}

func (c *Channel) LastMessage() Message {
	return c.RecentMessages[len(RecentMessages)-1]
}

func (c *Channel) Pulse() {
	c.PulsedAt = time.Now()
}

func (c *Channel) String() {
	return fmt.SPrintf("Channel: %v", c.Name)
}

// Core function of Channel
func (c *Channel) run() {
	for {
		select {
		case b := <-c.Broadcast:
			for _, online := range c.OnlineUsers {
				online.Send <- b
			}
		case c := <-c.CloseSign:
			if c == true {
				close(c.Broadcast)
				close(c.CloseSign)
				return
			}
		}
	}
}

func (c *Channel) validate() bool {
	return true
}
