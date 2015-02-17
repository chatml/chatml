package config

import (
	"path"
	"strings"
	"testing"
)

var fixturesPath = "fixtures"

var configTests = []struct {
	inputFile   string
	shouldFail  bool
	errContains string
}{
	{
		inputFile: "empty.conf.input",
	},
}

func TestConfigs(t *testing.T) {
	for i, configTest := range configTests {
		_, err := LoadFromFile(path.Join(fixturesPath, configTest.inputFile))

		if err != nil {
			if !configTest.shouldFail {
				t.Fatalf("%d. Error parsing config %v: %v", i, configTest.inputFile, err)
			} else {
				if !strings.Contains(err.Error(), configTest.errContains) {
					t.Fatalf("%d. Expected error containing '%v', got: %v", i, configTest.errContains, err)
				}
			}
		}
	}
}
