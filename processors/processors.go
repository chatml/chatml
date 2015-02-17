package processors

import (
	"fmt"
	"sync"
)

type MessageProcessor interface {
	ProcessMessage(message string) string
	IsExperimental() bool
	Description() string
}

type ProcessorRegistry struct {
	processors []MessageProcessor
	mu         *sync.Mutex
}

func (p *ProcessorRegistry) Register(processor MessageProcessor) {
	p.mu.Lock()
	defer p.mu.Unlock()

	append(processors, processor)
}

func (p *ProcessorRegistry) All() {
	return p.processors
}
