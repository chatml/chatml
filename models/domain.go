package models

import (
	"errors"
	"fmt"
)

type Domain struct {
	Name   string
	Active bool
}

func NewDomain(name string) (*Domain, error) {
	if name == nil || len(name) == 0 {
		return nil, errors.New(fmt.SPrintf("ArgumentError: %s", name))
	}
	return &Domain{name}
}

func (d *Domain) IsActive() bool {
	return d.Active
}

func (d *Domain) String() {
	return fmt.SPrintf("Domain: %v", d.Name)
}

// private methods

func (d *Domain) validate() bool {
	return true
}
