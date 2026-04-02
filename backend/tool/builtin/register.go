package builtin

import "github.com/chatml/chatml-backend/tool"

// Callbacks groups optional callback interfaces for interactive tools.
// These are provided by the Runner to enable tools that need to communicate
// with the frontend (user questions, plan approvals, todo updates).
type Callbacks struct {
	EmitEvent     func(eventType string, data interface{}) // For TodoWrite events
	UserQuestion  UserQuestionCallback                      // For AskUserQuestion
	PlanMode      PlanModeCallback                          // For EnterPlanMode/ExitPlanMode
}

// RegisterAll registers all built-in tools into the given registry.
func RegisterAll(reg *tool.Registry, workdir string) {
	RegisterAllWithCallbacks(reg, workdir, nil)
}

// RegisterAllWithCallbacks registers all built-in tools with optional callbacks
// for interactive tools (TodoWrite, AskUserQuestion, PlanMode).
func RegisterAllWithCallbacks(reg *tool.Registry, workdir string, cb *Callbacks) {
	// Shared read tracker: Read marks files as read, Edit/Write check before modifying.
	tracker := tool.NewReadTracker()

	// File/shell tools
	reg.Register(NewBashTool(workdir))
	reg.Register(NewReadToolWithTracker(workdir, tracker))
	reg.Register(NewWriteToolWithTracker(workdir, tracker))
	reg.Register(NewEditToolWithTracker(workdir, tracker))
	reg.Register(NewGlobTool(workdir))
	reg.Register(NewGrepTool(workdir))

	// Web tools
	reg.Register(NewWebFetchTool())
	reg.Register(NewWebSearchTool())

	// Interactive tools (require callbacks)
	var emitFn func(string, interface{})
	var uqCb UserQuestionCallback
	var pmCb PlanModeCallback
	if cb != nil {
		emitFn = cb.EmitEvent
		uqCb = cb.UserQuestion
		pmCb = cb.PlanMode
	}

	reg.Register(NewTodoWriteTool(emitFn))
	reg.Register(NewAskUserQuestionTool(uqCb))
	reg.Register(NewExitPlanModeTool(pmCb))
	reg.Register(NewEnterPlanModeTool(pmCb))

	// ToolSearch: discovers deferred tools (must be registered after all other tools)
	reg.Register(NewToolSearchTool(reg))
}
