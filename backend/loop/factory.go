package loop

import (
	"fmt"

	"github.com/chatml/chatml-backend/agent"
	"github.com/chatml/chatml-backend/loop/chatml"
	coreloop "github.com/chatml/chatml-core/loop"
)

// NewBackendFactory returns an agent.NativeBackendFactory that creates Runner
// (adapter) instances wrapping core/loop.Runner. The core factory handles all
// common setup (provider, permissions, tools, MCP, hooks, skills, task manager).
// This factory adds ChatML-specific tools on top.
//
// Services are captured by the closure and shared across all Runner instances.
func NewBackendFactory(svc *chatml.Services, repoMgr chatml.RepoManager) agent.NativeBackendFactory {
	coreFactory := coreloop.NewBackendFactory()

	return func(opts agent.ProcessOptions, apiKey, oauthToken string) (agent.ConversationBackend, error) {
		// Create core runner (builtin tools, hooks, skills, MCP, task manager, etc.)
		coreBackend, err := coreFactory(opts, apiKey, oauthToken)
		if err != nil {
			return nil, fmt.Errorf("create core runner: %w", err)
		}

		coreRunner, ok := coreBackend.(*coreloop.Runner)
		if !ok {
			return nil, fmt.Errorf("unexpected backend type from core factory: %T", coreBackend)
		}

		// Register ChatML built-in tools (mcp__chatml__*) on the core runner's registry
		tctx := &chatml.ToolContext{
			SessionID:    opts.BackendSessionID,
			WorkspaceID:  opts.WorkspaceID,
			Workdir:      opts.Workdir,
			TargetBranch: opts.TargetBranch,
			LinearIssue:  opts.LinearIssue,
		}
		chatml.RegisterAll(coreRunner, svc, repoMgr, tctx)

		return &Runner{core: coreRunner}, nil
	}
}
