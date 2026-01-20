export interface LinearIssue {
    id: string;
    identifier: string;
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
    linearIssue?: string;
}
export declare class WorkspaceContext {
    readonly cwd: string;
    readonly workspaceId: string;
    readonly sessionId: string;
    private _linearIssue;
    private _gitState;
    constructor(options: WorkspaceContextOptions);
    get linearIssue(): LinearIssue | null;
    setLinearIssue(issue: LinearIssue | null): void;
    get gitState(): GitState;
    refreshGitState(): GitState;
    private fetchGitState;
    private detectBaseBranch;
    private resolveLinearIssue;
    static resolveFromSources(options: WorkspaceContextOptions): string | null;
}
