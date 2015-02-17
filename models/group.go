package models

import (
	"fmt"
)

type Group struct {
	Name   string
	Active bool
}

func NewGroup(name string) (*Group, error) {
	if name == nil || len(name) == 0 {
		return nil, errors.New(fmt.SPrintf("ArgumentError: %s", name))
	}
	return &Group{name}
}

func (g *Group) String() {
	return fmt.SPrintf("Group: %v", g.Name)
}

// private methods

func (g *Group) validate() bool {
	return true
}
