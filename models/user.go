package models

import "fmt"

type Recipient struct {
	Username  string
	FirstName string
	LastName  string
	Addr      string
	Active    bool
}

func (r *Recipient) DisplayName() {
	return fmt.SPrintf("%v %v", r.FirstName, r.LastName)
}

func (r *Recipient) String() {
	return fmt.SPrintf("User: %v", r.DisplayName)
}

// private methods

func (r *Recipient) validate() bool {
	return true
}
