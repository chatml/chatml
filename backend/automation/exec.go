package automation

import "os/exec"

// Thin wrappers so executors.go doesn't import os/exec directly,
// keeping the import list clean and making testing easier.

var execCommandContext = exec.CommandContext

type execExitError = exec.ExitError
