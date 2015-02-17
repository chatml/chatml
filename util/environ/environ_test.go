// Copyright 2014 Codehack.com All rights reserved.
// Use of this source code is governed by a MIT-style
// license that can be found in the LICENSE file.

package environ

import "testing"
import "time"

var testEnv = NewEnv()
var arr = []string{"Lorem", "ipsum", "dolor", "sit", "amet", "consectetur", "adipiscing", "elit", "donec", "tempus", "Lorem"}

func TestPut(t *testing.T) {
	for _, v := range arr {
		testEnv.Put(v, v)
	}
	if e, v := "amet", testEnv.Get("amet"); v != e {
		t.Errorf("expecting %q got %q", e, v)
	}
	testEnv.Put("amet", "AMET")
	if e, v := "AMET", testEnv.Get("amet"); v != e {
		t.Errorf("expecting %q got %q", e, v)
	}
}

func TestIndex(t *testing.T) {
	if e, i := 2, testEnv.Index("dolor"); i != e {
		t.Errorf("expecting %d got %d", e, i)
	}
	if e, i := -1, testEnv.Index("horse"); i != e {
		t.Errorf("expecting %d got %d", e, i)
	}
}

func TestGet(t *testing.T) {
	if e, v := "elit", testEnv.Get("elit"); e != v {
		t.Errorf("expecting %q got %q", e, v)
	}
	if e, v := false, testEnv.GetBool("elit"); e != v {
		t.Errorf("expecting %t got %t", e, v)
	}
	if e, v := 0.0, testEnv.GetFloat("elit"); e != v {
		t.Errorf("expecting %f got %f", e, v)
	}
	if e, v := 0, testEnv.GetInt("elit"); e != v {
		t.Errorf("expecting %d got %d", e, v)
	}
}

type fake struct{}

func TestSet(t *testing.T) {
	testEnv.Set("Lorem", 1.01)
	testEnv.Set("ipsum", 123)
	testEnv.Set("dolor", true)
	testEnv.Set("sit", fake{})
	testEnv.Set("date", time.Time{})

	if e, v := 1.01, testEnv.GetFloat("Lorem"); e != v {
		t.Errorf("expecting %f got %f", e, v)
	}
	if e, v := 123, testEnv.GetInt("ipsum"); e != v {
		t.Errorf("expecting %q got %q", e, v)
	}
	if e, v := true, testEnv.GetBool("dolor"); e != v {
		t.Errorf("expecting %t got %t", e, v)
	}
	if e, v := "sit", testEnv.Get("sit"); e != v {
		t.Errorf("expecting %q got %q", e, v)
	}
	if e, v := "0001-01-01 00:00:00 +0000 UTC", testEnv.Get("date"); e != v {
		t.Errorf("expecting %q got %q", e, v)
	}
	if e, v := new(time.Time), testEnv.GetTime("date"); !e.Equal(v) {
		t.Errorf("expecting %q got %q", e, v)
	}
}
