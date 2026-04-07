package main

// Layout constants
const (
	inputWidthPadding = 6 // space for prompt prefix (❯ + padding)
)

// Tool rendering constants
const (
	maxSummaryWidth   = 80 // max chars for tool result summary line
	maxHeaderWidth    = 60 // max chars for tool header params
	bashPreviewLines  = 3  // lines of bash output to show in preview
	collapseThreshold = 10 // lines before tool output collapses
	maxTreeLines      = 30 // max lines in file tree display
	maxDiffLines      = 20 // max lines in edit diff display
)

// Agent rendering constants
const (
	agentProgressMaxShow = 3  // inner tool calls shown while agent runs
	agentExpandMaxShow   = 10 // inner tool calls shown when expanded
	thinkingMaxLines     = 50 // max thinking lines shown when expanded
)

// Approval constants
const (
	approvalOptionCount = 3 // yes, always, deny
	planOptionCount     = 2 // approve, reject
)
