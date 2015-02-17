// Copyright 2014 Codehack.com All rights reserved.
// Use of this source code is governed by a MIT-style
// license that can be found in the LICENSE file.

// Package environ is a system to implement the similar functionality as environment
// lists found in all Unix-based OS'. Basically, all the functions found at
// "man 3 setenv" from a Unix prompt. With some additions to support Go's basic types.
package environ

import (
	"errors"
	"fmt"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Env is an environment list with name=value values.
type Env []string

// envPool manages Env objects so they can be reused.
var envPool = sync.Pool{
	New: func() interface{} { return new(Env) },
}

// NewEnv returns a new Env list (or from pool).
func NewEnv() *Env { return envPool.Get().(*Env) }

// Free returns this Env e back into the pool for further use.
// It's recommended to use this function when we are done using e.
func (e *Env) Free() { envPool.Put(e) }

// Index returns the index of the first instance of name found in Env e, or
// -1 otherwise.
func (e *Env) Index(name string) int {
	prefix := name + "="
	for k, v := range *e {
		if strings.HasPrefix(v, prefix) {
			return k
		}
	}
	return -1
}

// Contains returns true if name is found in Env e.
func (e *Env) Contains(name string) bool {
	return e.Index(name) >= 0
}

// Get returns the string value matching name in Env e, or empty "" if not found.
func (e *Env) Get(name string) string {
	idx := e.Index(name)
	if idx == -1 {
		return ""
	}
	return (*e)[idx][len(name)+1:]
}

// Get returns the bool value matching name in Env e, or false if not found or the
// value is not a boolean.
func (e *Env) GetBool(name string) bool {
	v, err := strconv.ParseBool(e.Get(name))
	if err != nil {
		return false
	}
	return v
}

// Get returns the float value matching name in Env e, or 0 if not found or the
// value is not a float.
func (e *Env) GetFloat(name string) float64 {
	v, err := strconv.ParseFloat(e.Get(name), 0)
	if err != nil {
		return 0.0
	}
	return v
}

// Get returns the int value matching name in Env e, or 0 if not found or the
// value is not an int.
func (e *Env) GetInt(name string) int {
	v, err := strconv.Atoi(e.Get(name))
	if err != nil {
		return 0
	}
	return v
}

// Get returns the time.Time value matching name in Env e, or time.Time{} if not
// found or the value is not a time.Time. The parsing is done using format:
// "2006-01-02 15:04:05.999999999 -0700 MST", which is a variation on time.RFC3339Nano.
// The returned value should be checked with time.IsZero()
func (e *Env) GetTime(name string) time.Time {
	v, err := time.Parse("2006-01-02 15:04:05.999999999 -0700 MST", e.Get(name))
	if err != nil {
		return time.Time{}
	}
	return v
}

// Put inserts name=value into Env e if a value matching name is not found.
// Otherwise it replaces the current name=value with the new value.
func (e *Env) Put(name, value string) {
	idx := e.Index(name)
	if idx == -1 {
		*e = append(*e, name+"="+value)
		return
	}
	(*e)[idx] = name + "=" + value
}

// Set converts a known value type v to a string value and puts name=value in Env e.
// It returns nil if successful, error otherwise.
// Value types supported: bool, byte, uint (32 & 64), int (32 & 64), float32,
// float64 and string.
func (e *Env) Set(name string, v interface{}) error {
	var value string
	switch v.(type) {
	case bool:
		value = strconv.FormatBool(v.(bool))
	case byte:
		value = string(v.(byte))
	case uint, uint32:
		value = strconv.FormatUint(uint64(v.(uint)), 10)
	case uint64:
		value = strconv.FormatUint(v.(uint64), 10)
	case int, int32:
		value = strconv.FormatInt(int64(v.(int)), 10)
	case int64:
		value = strconv.FormatInt(v.(int64), 10)
	case float32, float64:
		value = strconv.FormatFloat(v.(float64), 'f', -1, 64)
	case string:
		value = v.(string)
	case fmt.Stringer:
		value = v.(fmt.Stringer).String()
	default:
		t := reflect.TypeOf(v)
		return errors.New("environ.Set: " + name + ": value " + strconv.Quote(t.String()) + " is not supported")
	}
	e.Put(name, value)
	return nil
}

// Unset empties all values with found with name. Note that this function won't
// remove name=value pairs, just set value to empty string "".
func (e *Env) Unset(name string) {
	// we dont really delete, just empty
	e.Put(name, "")
}

// Print will print all name=value pairs to stdout.
func (e *Env) Print() {
	for k, v := range *e {
		fmt.Println(k, "=", v)
	}
}
