package builtin

import (
	"github.com/chatml/chatml-core/skills"
	"github.com/chatml/chatml-core/tool"
)

// Callbacks groups optional callback interfaces for interactive tools.
// These are provided by the Runner to enable tools that need to communicate
// with the frontend (user questions, plan approvals, todo updates).
type Callbacks struct {
	EmitEvent        func(eventType string, data interface{}) // For TodoWrite events
	UserQuestion     UserQuestionCallback                      // For AskUserQuestion
	PlanMode         PlanModeCallback                          // For EnterPlanMode/ExitPlanMode
	AgentSpawner     AgentSpawner                              // For Agent sub-agent tool
	WebSearchAPIKey  string                                    // Brave Search API key for WebSearch tool
	WorkdirSetter    WorkdirSetter                             // For EnterWorktree/ExitWorktree

	// ReadTrackerOut is populated after RegisterAllWithCallbacks returns.
	// The runner uses it for post-compact context restoration.
	ReadTrackerOut *tool.ReadTracker

	// TaskManager for Tasks v2 tools (TaskCreate/Get/Update/List/Stop/Output).
	TaskManager TaskManager

	// SkillCatalog for Skill tool execution.
	SkillCatalog *skills.Catalog
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

	// Notebook editing
	reg.Register(NewNotebookEditTool(workdir, tracker))

	// Web tools
	reg.Register(NewWebFetchTool())
	var webSearchAPIKey string
	if cb != nil {
		webSearchAPIKey = cb.WebSearchAPIKey
	}
	reg.Register(NewWebSearchTool(webSearchAPIKey))

	// Interactive tools (require callbacks)
	var emitFn func(string, interface{})
	var uqCb UserQuestionCallback
	var pmCb PlanModeCallback
	var agentSpawner AgentSpawner
	if cb != nil {
		emitFn = cb.EmitEvent
		uqCb = cb.UserQuestion
		pmCb = cb.PlanMode
		agentSpawner = cb.AgentSpawner
	}

	reg.Register(NewTodoWriteTool(emitFn))
	reg.Register(NewAskUserQuestionTool(uqCb))
	reg.Register(NewExitPlanModeTool(pmCb))
	reg.Register(NewEnterPlanModeTool(pmCb))

	// Agent tool: spawns sub-agent runners
	reg.Register(NewAgentTool(agentSpawner))

	// Worktree tools (require WorkdirSetter)
	if cb != nil && cb.WorkdirSetter != nil {
		reg.Register(NewEnterWorktreeTool(cb.WorkdirSetter))
		reg.Register(NewExitWorktreeTool(cb.WorkdirSetter))
	}

	// Skill tool
	if cb != nil && cb.SkillCatalog != nil {
		reg.Register(NewSkillTool(cb.SkillCatalog))
	}

	// Task v2 tools (deferred — discovered via ToolSearch)
	if cb != nil && cb.TaskManager != nil {
		reg.Register(NewTaskCreateTool(cb.TaskManager))
		reg.Register(NewTaskGetTool(cb.TaskManager))
		reg.Register(NewTaskUpdateTool(cb.TaskManager))
		reg.Register(NewTaskListTool(cb.TaskManager))
		reg.Register(NewTaskStopTool(cb.TaskManager))
		reg.Register(NewTaskOutputTool(cb.TaskManager))
	}

	// Cron scheduling tools (deferred)
	if workdir != "" {
		cronStore := NewCronStore(workdir)
		reg.Register(NewCronCreateTool(cronStore))
		reg.Register(NewCronListTool(cronStore))
		reg.Register(NewCronDeleteTool(cronStore))
	}

	// ToolSearch: discovers deferred tools (must be registered after all other tools)
	reg.Register(NewToolSearchTool(reg))

	// Expose the read tracker for post-compact context restoration
	if cb != nil {
		cb.ReadTrackerOut = tracker
	}
}
