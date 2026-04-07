package chatml

import (
	"github.com/chatml/chatml-core/tool"
)

// ToolRegisterer is the minimal interface for registering tools.
// Satisfied by core/loop.Runner (via RegisterTool) and tool.Registry.
type ToolRegisterer interface {
	RegisterTool(t tool.Tool)
}

// RegisterAll registers all 18 ChatML built-in tools.
// These provide the same functionality as the agent-runner's TypeScript MCP
// server (mcp__chatml__* tools) but call backend services directly.
func RegisterAll(reg ToolRegisterer, svc *Services, repoMgr RepoManager, tctx *ToolContext) {
	linearState := NewLinearIssueState(tctx.LinearIssue)

	tools := []tool.Tool{
		// Review comments (5 tools)
		&addReviewCommentTool{svc: svc, ctx: tctx},
		&listReviewCommentsTool{svc: svc, ctx: tctx},
		&resolveReviewCommentTool{svc: svc, ctx: tctx},
		&getReviewCommentStatsTool{svc: svc, ctx: tctx},
		&submitReviewScorecardTool{svc: svc, ctx: tctx},

		// Session/workspace (3 tools)
		&getSessionStatusTool{svc: svc, repo: repoMgr, ctx: tctx, linear: linearState},
		&getWorkspaceDiffTool{svc: svc, repo: repoMgr, ctx: tctx},
		&getRecentActivityTool{repo: repoMgr, ctx: tctx},

		// PR (3 tools)
		&reportPRCreatedTool{svc: svc, ctx: tctx},
		&reportPRMergedTool{svc: svc, ctx: tctx},
		&clearPRLinkTool{svc: svc, ctx: tctx},

		// Linear (4 tools)
		&getLinearContextTool{linear: linearState},
		&startLinearIssueTool{linear: linearState, ctx: tctx},
		&clearLinearIssueTool{linear: linearState},
		&updateLinearStatusTool{linear: linearState},

		// Scripts (2 tools)
		&getWorkspaceScriptsConfigTool{ctx: tctx},
		&proposeScriptsConfigTool{ctx: tctx},

		// QA (1 tool)
		&requestUserBrowserActionTool{ctx: tctx},
	}

	for _, t := range tools {
		reg.RegisterTool(t)
	}
}
