package builtin

import "github.com/chatml/chatml-backend/tool"

// RegisterAll registers all built-in tools into the given registry.
func RegisterAll(reg *tool.Registry, workdir string) {
	reg.Register(NewBashTool(workdir))
	reg.Register(NewReadTool(workdir))
	reg.Register(NewWriteTool(workdir))
	reg.Register(NewEditTool(workdir))
	reg.Register(NewGlobTool(workdir))
	reg.Register(NewGrepTool(workdir))
}
