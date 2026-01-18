package agent

import (
	"bufio"
	"context"
	"fmt"
	"os/exec"
	"sync"
)

type Process struct {
	ID      string
	cmd     *exec.Cmd
	cancel  context.CancelFunc
	output  chan string
	done    chan struct{}
	mu      sync.Mutex
	running bool
	exitErr error
}

func NewProcess(id, workdir, task string) *Process {
	ctx, cancel := context.WithCancel(context.Background())

	cmd := exec.CommandContext(ctx, "claude",
		"-p", task,
		"--dangerously-skip-permissions",
		"--output-format", "stream-json",
		"--verbose",
	)
	cmd.Dir = workdir

	return &Process{
		ID:     id,
		cmd:    cmd,
		cancel: cancel,
		output: make(chan string, 100),
		done:   make(chan struct{}),
	}
}

func (p *Process) Start() error {
	p.mu.Lock()
	defer p.mu.Unlock()

	stdout, err := p.cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("stdout pipe: %w", err)
	}

	stderr, err := p.cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("stderr pipe: %w", err)
	}

	if err := p.cmd.Start(); err != nil {
		return fmt.Errorf("start: %w", err)
	}

	p.running = true

	// Stream stdout
	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			select {
			case p.output <- scanner.Text():
			default:
				// Drop if buffer full
			}
		}
	}()

	// Stream stderr
	go func() {
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			select {
			case p.output <- "[stderr] " + scanner.Text():
			default:
			}
		}
	}()

	// Wait for completion
	go func() {
		err := p.cmd.Wait()
		p.mu.Lock()
		p.running = false
		p.exitErr = err
		p.mu.Unlock()
		close(p.done)
	}()

	return nil
}

func (p *Process) Stop() {
	p.cancel()
}

func (p *Process) Output() <-chan string {
	return p.output
}

func (p *Process) Done() <-chan struct{} {
	return p.done
}

func (p *Process) IsRunning() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.running
}

func (p *Process) ExitError() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.exitErr
}
