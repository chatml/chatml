package config

import (
	"testing"
)

func TestLoadFromFile(t *testing.T) {
	_, err := LoadFromFile("file-does-not-exist.conf")
	if err == nil {
		t.Error(err)
	}
}
