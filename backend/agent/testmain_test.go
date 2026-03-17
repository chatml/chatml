package agent

import (
	"fmt"
	"os"
	"testing"

	"github.com/chatml/chatml-backend/appdir"
)

func TestMain(m *testing.M) {
	tmpHome, err := os.MkdirTemp("", "chatml-test-home-*")
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to create temp home: %v\n", err)
		os.Exit(1)
	}
	os.Setenv("HOME", tmpHome)
	appdir.Init()

	code := m.Run()
	os.RemoveAll(tmpHome)
	os.Exit(code)
}
