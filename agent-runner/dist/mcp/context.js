// agent-runner/src/mcp/context.ts
import { execSync } from "child_process";
export class WorkspaceContext {
    cwd;
    workspaceId;
    sessionId;
    _linearIssue = null;
    _gitState = null;
    constructor(options) {
        this.cwd = options.cwd;
        this.workspaceId = options.workspaceId;
        this.sessionId = options.sessionId;
        // Resolve Linear issue from CLI arg or other sources
        if (options.linearIssue) {
            this._linearIssue = this.resolveLinearIssue(options.linearIssue);
        }
    }
    get linearIssue() {
        return this._linearIssue;
    }
    setLinearIssue(issue) {
        this._linearIssue = issue;
    }
    get gitState() {
        if (!this._gitState) {
            this._gitState = this.fetchGitState();
        }
        return this._gitState;
    }
    refreshGitState() {
        this._gitState = this.fetchGitState();
        return this._gitState;
    }
    fetchGitState() {
        try {
            const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: this.cwd, encoding: "utf-8" }).trim();
            const baseBranch = this.detectBaseBranch();
            const status = execSync("git status --porcelain", { cwd: this.cwd, encoding: "utf-8" });
            const uncommittedChanges = status.trim().length > 0;
            let aheadBy = 0;
            let behindBy = 0;
            try {
                const counts = execSync(`git rev-list --left-right --count ${baseBranch}...HEAD`, { cwd: this.cwd, encoding: "utf-8" }).trim();
                const [behind, ahead] = counts.split("\t").map(Number);
                aheadBy = ahead || 0;
                behindBy = behind || 0;
            }
            catch {
                // Branch might not have upstream
            }
            return { branch, baseBranch, uncommittedChanges, aheadBy, behindBy };
        }
        catch {
            return { branch: "unknown", baseBranch: "main", uncommittedChanges: false, aheadBy: 0, behindBy: 0 };
        }
    }
    detectBaseBranch() {
        try {
            // Check for common base branch names
            const branches = execSync("git branch -r", { cwd: this.cwd, encoding: "utf-8" });
            if (branches.includes("origin/main"))
                return "origin/main";
            if (branches.includes("origin/master"))
                return "origin/master";
            return "main";
        }
        catch {
            return "main";
        }
    }
    resolveLinearIssue(identifier) {
        // TODO: Implement actual Linear API resolution when MCP Linear server is integrated.
        // This placeholder returns a minimal structure so the context can be populated.
        // When implementing, consider using the Linear SDK or MCP Linear server's get_issue tool.
        return {
            id: identifier,
            identifier,
            title: `Issue ${identifier}`,
            description: "",
            state: "unknown",
            labels: [],
        };
    }
    // Resolve Linear issue from multiple sources (priority order)
    static resolveFromSources(options) {
        // 1. Explicit CLI arg (highest priority)
        if (options.linearIssue) {
            return options.linearIssue;
        }
        // 2. Branch name pattern (feat/LIN-123-description)
        try {
            const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: options.cwd, encoding: "utf-8" }).trim();
            const match = branch.match(/([A-Z]+-\d+)/);
            if (match) {
                return match[1];
            }
        }
        catch {
            // Ignore git errors
        }
        // 3. Recent commit messages
        try {
            const logs = execSync("git log -5 --oneline", { cwd: options.cwd, encoding: "utf-8" });
            const match = logs.match(/([A-Z]+-\d+)/);
            if (match) {
                return match[1];
            }
        }
        catch {
            // Ignore git errors
        }
        return null;
    }
}
