// agent-runner/src/mcp/context.ts
import { execSync } from "child_process";

export interface LinearIssue {
  id: string;
  identifier: string;  // "LIN-123"
  title: string;
  description: string;
  state: string;
  labels: string[];
  assignee?: string;
  project?: string;
}

export interface GitState {
  branch: string;
  baseBranch: string;
  uncommittedChanges: boolean;
  aheadBy: number;
  behindBy: number;
}

export interface WorkspaceContextOptions {
  cwd: string;
  workspaceId: string;
  sessionId: string;
  linearIssue?: string; // CLI arg like "LIN-123"
}

export class WorkspaceContext {
  readonly cwd: string;
  readonly workspaceId: string;
  readonly sessionId: string;
  private _linearIssue: LinearIssue | null = null;
  private _gitState: GitState | null = null;

  constructor(options: WorkspaceContextOptions) {
    this.cwd = options.cwd;
    this.workspaceId = options.workspaceId;
    this.sessionId = options.sessionId;

    // Resolve Linear issue from CLI arg or other sources
    if (options.linearIssue) {
      this._linearIssue = this.resolveLinearIssue(options.linearIssue);
    }
  }

  get linearIssue(): LinearIssue | null {
    return this._linearIssue;
  }

  setLinearIssue(issue: LinearIssue | null): void {
    this._linearIssue = issue;
  }

  get gitState(): GitState {
    if (!this._gitState) {
      this._gitState = this.fetchGitState();
    }
    return this._gitState;
  }

  refreshGitState(): GitState {
    this._gitState = this.fetchGitState();
    return this._gitState;
  }

  private fetchGitState(): GitState {
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
      } catch {
        // Branch might not have upstream
      }

      return { branch, baseBranch, uncommittedChanges, aheadBy, behindBy };
    } catch {
      return { branch: "unknown", baseBranch: "main", uncommittedChanges: false, aheadBy: 0, behindBy: 0 };
    }
  }

  private detectBaseBranch(): string {
    try {
      // Check for common base branch names
      const branches = execSync("git branch -r", { cwd: this.cwd, encoding: "utf-8" });
      if (branches.includes("origin/main")) return "origin/main";
      if (branches.includes("origin/master")) return "origin/master";
      return "main";
    } catch {
      return "main";
    }
  }

  private resolveLinearIssue(identifier: string): LinearIssue | null {
    // Placeholder - will be implemented with Linear MCP integration
    // For now, return a minimal issue structure
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
  static resolveFromSources(options: WorkspaceContextOptions): string | null {
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
    } catch {
      // Ignore git errors
    }

    // 3. Recent commit messages
    try {
      const logs = execSync("git log -5 --oneline", { cwd: options.cwd, encoding: "utf-8" });
      const match = logs.match(/([A-Z]+-\d+)/);
      if (match) {
        return match[1];
      }
    } catch {
      // Ignore git errors
    }

    return null;
  }
}
