package agent

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
)

// AgentRunnerPath can be set to override the default agent-runner location
var AgentRunnerPath string

type Process struct {
	ID             string
	ConversationID string
	cmd            *exec.Cmd
	stdin          io.WriteCloser
	cancel         context.CancelFunc
	output         chan string
	done           chan struct{}
	mu             sync.Mutex
	running        bool
	exitErr        error
}

// InputMessage represents a message sent to the agent runner via stdin
type InputMessage struct {
	Type    string `json:"type"`
	Content string `json:"content,omitempty"`
}

// findAgentRunner locates the agent-runner executable
func findAgentRunner() string {
	// 1. Check environment variable
	if path := os.Getenv("CHATML_AGENT_RUNNER"); path != "" {
		return path
	}

	// 2. Check package-level override
	if AgentRunnerPath != "" {
		return AgentRunnerPath
	}

	// 3. Try relative to current working directory (development)
	cwd, _ := os.Getwd()
	candidates := []string{
		filepath.Join(cwd, "agent-runner", "dist", "index.js"),
		filepath.Join(cwd, "..", "agent-runner", "dist", "index.js"),
		filepath.Join(cwd, "..", "..", "agent-runner", "dist", "index.js"),
	}

	for _, path := range candidates {
		if _, err := os.Stat(path); err == nil {
			return path
		}
	}

	// 4. Fallback to expecting it in PATH or configured location
	return "chatml-agent-runner"
}

func NewProcess(id, workdir, conversationID string) *Process {
	ctx, cancel := context.WithCancel(context.Background())

	agentRunnerPath := findAgentRunner()

	// Spawn the Node agent runner
	cmd := exec.CommandContext(ctx, "node",
		agentRunnerPath,
		"--cwd", workdir,
		"--conversation-id", conversationID,
	)
	cmd.Dir = workdir

	return &Process{
		ID:             id,
		ConversationID: conversationID,
		cmd:            cmd,
		cancel:         cancel,
		output:         make(chan string, 100),
		done:           make(chan struct{}),
	}
}

func (p *Process) Start() error {
	p.mu.Lock()
	defer p.mu.Unlock()

	stdin, err := p.cmd.StdinPipe()
	if err != nil {
		return fmt.Errorf("stdin pipe: %w", err)
	}
	p.stdin = stdin

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

	// WaitGroup to track when stdout/stderr goroutines complete
	var outputWg sync.WaitGroup
	outputWg.Add(2)

	// Stream stdout
	go func() {
		defer outputWg.Done()
		scanner := bufio.NewScanner(stdout)
		// Increase buffer for large JSON events
		buf := make([]byte, 0, 1024*1024)
		scanner.Buffer(buf, 10*1024*1024)
		for scanner.Scan() {
			select {
			case p.output <- scanner.Text():
			default:
				log.Printf("[process:%s] Output buffer full, dropping stdout message", p.ID)
			}
		}
	}()

	// Stream stderr
	go func() {
		defer outputWg.Done()
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			select {
			case p.output <- "[stderr] " + scanner.Text():
			default:
				log.Printf("[process:%s] Output buffer full, dropping stderr message", p.ID)
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

		// Wait for stdout/stderr goroutines to finish before closing output channel
		outputWg.Wait()
		close(p.output)

		close(p.done)
	}()

	return nil
}

// SendMessage sends a user message to the running agent process
func (p *Process) SendMessage(content string) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if !p.running {
		return fmt.Errorf("process not running")
	}

	if p.stdin == nil {
		return fmt.Errorf("stdin not available")
	}

	msg := InputMessage{
		Type:    "message",
		Content: content,
	}

	data, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("marshal message: %w", err)
	}

	// Write JSON line to stdin
	_, err = p.stdin.Write(append(data, '\n'))
	if err != nil {
		return fmt.Errorf("write to stdin: %w", err)
	}

	return nil
}

// SendStop sends a stop message to gracefully terminate the agent
func (p *Process) SendStop() error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if !p.running {
		return nil // Already stopped
	}

	if p.stdin == nil {
		return fmt.Errorf("stdin not available")
	}

	msg := InputMessage{
		Type: "stop",
	}

	data, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("marshal stop message: %w", err)
	}

	_, err = p.stdin.Write(append(data, '\n'))
	if err != nil {
		return fmt.Errorf("write stop to stdin: %w", err)
	}

	return nil
}

func (p *Process) Stop() {
	p.mu.Lock()
	if p.stdin != nil {
		p.stdin.Close()
	}
	p.mu.Unlock()
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
