package processors

import (
	"fmt"
	"strings"
)

type UppercaseProcessor struct {
	*MessageProcessor
}

func (p *UppercaseProcessor) ProcessMessage(message string) string {
	return strings.ToUpper(message)
}

func (p *UppercaseProcessor) IsExperimental() bool {
	return false
}

func (p *UppercaseProcessor) GetDescription() string {
	return "Processor that converts message to all Uppercase characters"
}

func init() {
	processorRegistry.Register(new(UppercaseProcessor))
}
