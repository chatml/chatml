package main

import (
	"fmt"
	"io"
	"sync"
	"time"

	"github.com/charmbracelet/lipgloss"
)

var spinnerFrames = []string{"⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"}

type spinner struct {
	mu     sync.Mutex
	active bool
	label  string
	idx    int
	done   chan struct{}
	out    io.Writer
	style  lipgloss.Style
}

func newSpinner(out io.Writer) *spinner {
	return &spinner{
		out:   out,
		style: lipgloss.NewStyle().Foreground(lipgloss.Color("#F59E0B")),
	}
}

func (s *spinner) Start(label string) {
	s.mu.Lock()
	if s.active {
		s.mu.Unlock()
		s.Update(label)
		return
	}
	s.active = true
	s.label = label
	s.idx = 0
	s.done = make(chan struct{})
	s.mu.Unlock()

	go func() {
		ticker := time.NewTicker(80 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-s.done:
				return
			case <-ticker.C:
				s.mu.Lock()
				frame := spinnerFrames[s.idx%len(spinnerFrames)]
				lbl := s.label
				s.idx++
				s.mu.Unlock()

				// Write spinner in-place: \r moves to start of line, \033[K clears to end
				fmt.Fprintf(s.out, "\r  %s %s\033[K", s.style.Render(frame), lbl)
			}
		}
	}()
}

func (s *spinner) Update(label string) {
	s.mu.Lock()
	s.label = label
	s.mu.Unlock()
}

func (s *spinner) Stop() {
	s.mu.Lock()
	if !s.active {
		s.mu.Unlock()
		return
	}
	s.active = false
	close(s.done)
	s.mu.Unlock()

	// Clear the spinner line
	fmt.Fprint(s.out, "\r\033[K")
}
