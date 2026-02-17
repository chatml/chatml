'use client';

import { useState, useMemo, memo, useEffect, useRef } from 'react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  ChevronRight,
  ChevronDown,
  Circle,
  CheckCircle2,
  Loader2,
  Users,
  ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/appStore';
import { ToolUsageBlock } from '@/components/conversation/ToolUsageBlock';
import { CachedMarkdown } from '@/components/shared/CachedMarkdown';
import type { SubAgent } from '@/lib/types';

// Map agent types to short display labels
function getAgentLabel(agentType: string): string {
  switch (agentType) {
    case 'Explore':
      return 'Explore';
    case 'Bash':
      return 'Bash';
    case 'general-purpose':
      return 'Agent';
    case 'Plan':
      return 'Plan';
    case 'superpowers:code-reviewer':
      return 'Code Review';
    case 'teammate':
    case 'team_member':
      return 'Teammate';
    default:
      return agentType;
  }
}

function AgentElapsedTime({ startTime }: { startTime: number }) {
  const [elapsed, setElapsed] = useState(() => Math.floor((Date.now() - startTime) / 1000));
  const startRef = useRef(startTime);

  useEffect(() => {
    startRef.current = startTime;
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  if (elapsed < 1) return null;
  return (
    <span className="text-2xs text-muted-foreground/70 font-mono tabular-nums shrink-0">
      {elapsed}s
    </span>
  );
}

interface SubAgentRowProps {
  agent: SubAgent;
  worktreePath?: string;
}

// Strip redundant agent-type prefix from description (e.g., "Explore project structure" on an Explore agent → "project structure")
function stripAgentPrefix(description: string, agentType: string): string {
  const label = getAgentLabel(agentType).toLowerCase();
  if (description.toLowerCase().startsWith(label + ' ')) {
    return description.slice(label.length + 1);
  }
  return description;
}

// Extract the first nested Task tool's description from a sub-agent's tools
function getNestedTaskDescription(agent: SubAgent): string | undefined {
  const taskTool = agent.tools.find(t => t.tool === 'Task' && t.params?.description);
  return taskTool?.params?.description as string | undefined;
}

export const SubAgentRow = memo(function SubAgentRow({ agent, worktreePath }: SubAgentRowProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasTools = agent.tools.length > 0;
  const hasExpandableContent = hasTools || !!agent.output;

  // Current tool summary: last active tool or last completed tool
  const currentTool = useMemo(() => {
    const activeTool = agent.tools.find(t => !t.endTime);
    if (activeTool) return activeTool;
    return agent.tools[agent.tools.length - 1];
  }, [agent.tools]);

  // Display description: strip redundant agent-type prefix
  const displayDescription = useMemo(() => {
    if (!agent.description) return null;
    return stripAgentPrefix(agent.description, agent.agentType);
  }, [agent.description, agent.agentType]);

  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <CollapsibleTrigger
        className={cn(
          'flex items-center gap-1.5 text-base w-full rounded px-1.5 py-0.5 transition-colors',
          'hover:bg-surface-2',
        )}
      >
        {/* Status indicator */}
        <span className="flex items-center justify-center w-3 h-3 shrink-0">
          {agent.completed ? (
            <Circle className="w-2 h-2 fill-text-success text-text-success" />
          ) : (
            <span className="block w-2 h-2 rounded-full border-[1.5px] border-primary border-t-transparent animate-spin" />
          )}
        </span>

        {/* Agent type label */}
        <span className="font-medium text-foreground">{getAgentLabel(agent.agentType)}</span>

        {/* Task description (preferred) or current tool summary (fallback) */}
        {displayDescription ? (
          <span className="text-muted-foreground italic truncate max-w-[300px]">
            {displayDescription}
          </span>
        ) : currentTool && (
          <span className="text-muted-foreground truncate max-w-[200px]">
            {currentTool.endTime ? currentTool.tool : `running ${currentTool.tool}`}
          </span>
        )}

        {/* Tool count badge */}
        {agent.tools.length > 0 && (
          <span className="text-2xs px-1 py-0.5 rounded bg-muted text-muted-foreground font-mono">
            {agent.tools.filter(t => t.endTime).length}/{agent.tools.length}
          </span>
        )}

        <span className="flex-1" />

        {/* Duration: live elapsed for active, final for completed */}
        {agent.completed && agent.endTime ? (
          <span className="text-2xs text-muted-foreground/70 font-mono tabular-nums shrink-0">
            {((agent.endTime - agent.startTime) / 1000).toFixed(1)}s
          </span>
        ) : !agent.completed ? (
          <AgentElapsedTime startTime={agent.startTime} />
        ) : null}

        {/* Expand indicator */}
        {hasExpandableContent && (
          <span className="shrink-0 text-muted-foreground">
            {isExpanded ? (
              <ChevronDown className="w-2.5 h-2.5" />
            ) : (
              <ChevronRight className="w-2.5 h-2.5" />
            )}
          </span>
        )}
      </CollapsibleTrigger>

      {hasExpandableContent && (
        <CollapsibleContent>
          <div className="ml-4 space-y-1">
            {/* Sub-agent markdown output (when available) */}
            {agent.output && (
              <div className="prose prose-sm dark:prose-invert max-w-none text-sm px-2 py-1 rounded bg-muted/30">
                <CachedMarkdown
                  cacheKey={`subagent-output:${agent.agentId}`}
                  content={agent.output}
                />
              </div>
            )}
            {/* Tool list */}
            {hasTools && (
              <div className="space-y-0.5">
                {agent.tools.map((tool) => (
                  <ToolUsageBlock
                    key={tool.id}
                    id={tool.id}
                    tool={tool.tool}
                    params={tool.params}
                    worktreePath={worktreePath}
                    isActive={!tool.endTime}
                    success={tool.success}
                    summary={tool.summary}
                    duration={tool.endTime ? tool.endTime - tool.startTime : undefined}
                    stdout={tool.stdout}
                    stderr={tool.stderr}
                    elapsedSeconds={tool.elapsedSeconds}
                  />
                ))}
              </div>
            )}
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
});

// Compact row for an individual agent inside a grouped view — shows nested Task description as label
const SubAgentCompactRow = memo(function SubAgentCompactRow({ agent, worktreePath }: SubAgentRowProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasTools = agent.tools.length > 0;
  const hasExpandableContent = hasTools || !!agent.output;

  const nestedDescription = useMemo(() => getNestedTaskDescription(agent), [agent]);

  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <CollapsibleTrigger
        className={cn(
          'flex items-center gap-1.5 text-base w-full rounded px-1.5 py-0.5 transition-colors',
          'hover:bg-surface-2',
        )}
      >
        <span className="flex items-center justify-center w-3 h-3 shrink-0">
          {agent.completed ? (
            <Circle className="w-2 h-2 fill-text-success text-text-success" />
          ) : (
            <span className="block w-2 h-2 rounded-full border-[1.5px] border-primary border-t-transparent animate-spin" />
          )}
        </span>

        {/* Nested Task description (specific) or fallback to tool count */}
        {nestedDescription ? (
          <span className="text-muted-foreground italic truncate max-w-[300px]">
            {nestedDescription}
          </span>
        ) : (
          <span className="text-muted-foreground text-2xs">
            {agent.tools.length} tool{agent.tools.length !== 1 ? 's' : ''}
          </span>
        )}

        {/* Tool count badge */}
        {agent.tools.length > 0 && (
          <span className="text-2xs px-1 py-0.5 rounded bg-muted text-muted-foreground font-mono">
            {agent.tools.filter(t => t.endTime).length}/{agent.tools.length}
          </span>
        )}

        <span className="flex-1" />

        {/* Duration */}
        {agent.completed && agent.endTime ? (
          <span className="text-2xs text-muted-foreground/70 font-mono tabular-nums shrink-0">
            {((agent.endTime - agent.startTime) / 1000).toFixed(1)}s
          </span>
        ) : !agent.completed ? (
          <AgentElapsedTime startTime={agent.startTime} />
        ) : null}

        {hasExpandableContent && (
          <span className="shrink-0 text-muted-foreground">
            {isExpanded ? (
              <ChevronDown className="w-2.5 h-2.5" />
            ) : (
              <ChevronRight className="w-2.5 h-2.5" />
            )}
          </span>
        )}
      </CollapsibleTrigger>

      {hasExpandableContent && (
        <CollapsibleContent>
          <div className="ml-4 space-y-1">
            {agent.output && (
              <div className="prose prose-sm dark:prose-invert max-w-none text-sm px-2 py-1 rounded bg-muted/30">
                <CachedMarkdown
                  cacheKey={`subagent-output:${agent.agentId}`}
                  content={agent.output}
                />
              </div>
            )}
            {hasTools && (
              <div className="space-y-0.5">
                {agent.tools.map((tool) => (
                  <ToolUsageBlock
                    key={tool.id}
                    id={tool.id}
                    tool={tool.tool}
                    params={tool.params}
                    worktreePath={worktreePath}
                    isActive={!tool.endTime}
                    success={tool.success}
                    summary={tool.summary}
                    duration={tool.endTime ? tool.endTime - tool.startTime : undefined}
                    stdout={tool.stdout}
                    stderr={tool.stderr}
                    elapsedSeconds={tool.elapsedSeconds}
                  />
                ))}
              </div>
            )}
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
});

// Grouped row that collapses multiple same-description sub-agents under a single header
interface SubAgentGroupedRowProps {
  agents: SubAgent[];
  worktreePath?: string;
}

export const SubAgentGroupedRow = memo(function SubAgentGroupedRow({ agents, worktreePath }: SubAgentGroupedRowProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  const firstAgent = agents[0];
  const allCompleted = agents.every(a => a.completed);
  const anyActive = agents.some(a => !a.completed);

  const displayDescription = useMemo(() => {
    if (!firstAgent.description) return null;
    return stripAgentPrefix(firstAgent.description, firstAgent.agentType);
  }, [firstAgent.description, firstAgent.agentType]);

  // Total duration: from earliest start to latest end
  const totalDuration = useMemo(() => {
    if (!allCompleted) return null;
    const starts = agents.map(a => a.startTime);
    const ends = agents.filter(a => a.endTime).map(a => a.endTime!);
    if (ends.length === 0) return null;
    return Math.max(...ends) - Math.min(...starts);
  }, [agents, allCompleted]);

  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <CollapsibleTrigger
        className={cn(
          'flex items-center gap-1.5 text-base w-full rounded px-1.5 py-0.5 transition-colors',
          'hover:bg-surface-2',
        )}
      >
        {/* Status indicator */}
        <span className="flex items-center justify-center w-3 h-3 shrink-0">
          {allCompleted ? (
            <Circle className="w-2 h-2 fill-text-success text-text-success" />
          ) : anyActive ? (
            <span className="block w-2 h-2 rounded-full border-[1.5px] border-primary border-t-transparent animate-spin" />
          ) : (
            <Circle className="w-2 h-2 fill-muted-foreground/50 text-muted-foreground/50" />
          )}
        </span>

        {/* Agent type label */}
        <span className="font-medium text-foreground">{getAgentLabel(firstAgent.agentType)}</span>

        {/* Shared description */}
        {displayDescription && (
          <span className="text-muted-foreground italic truncate max-w-[300px]">
            {displayDescription}
          </span>
        )}

        {/* Count badge */}
        <span className="text-2xs px-1 py-0.5 rounded bg-muted text-muted-foreground font-mono">
          {'\u00D7'}{agents.length}
        </span>

        <span className="flex-1" />

        {/* Total duration */}
        {totalDuration ? (
          <span className="text-2xs text-muted-foreground/70 font-mono tabular-nums shrink-0">
            {(totalDuration / 1000).toFixed(1)}s
          </span>
        ) : anyActive ? (
          <AgentElapsedTime startTime={Math.min(...agents.map(a => a.startTime))} />
        ) : null}

        <span className="shrink-0 text-muted-foreground">
          {isExpanded ? (
            <ChevronDown className="w-2.5 h-2.5" />
          ) : (
            <ChevronRight className="w-2.5 h-2.5" />
          )}
        </span>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="ml-4 space-y-0.5">
          {agents.map((agent) => (
            <SubAgentCompactRow key={agent.agentId} agent={agent} worktreePath={worktreePath} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
});

// Clickable card for teammate sub-agents — navigates to their conversation tab
const TeammateCard = memo(function TeammateCard({ agent }: { agent: SubAgent }) {
  const conversations = useAppStore(s => s.conversations);
  const selectConversation = useAppStore(s => s.selectConversation);

  const teammateConv = useMemo(
    () => conversations.find(c => c.teamAgentId === agent.agentId),
    [conversations, agent.agentId]
  );

  const displayDescription = useMemo(() => {
    if (!agent.description) return 'Teammate';
    return stripAgentPrefix(agent.description, agent.agentType);
  }, [agent.description, agent.agentType]);

  const handleNavigate = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (teammateConv) {
      selectConversation(teammateConv.id);
    }
  };

  const completedTools = agent.tools.filter(t => t.endTime).length;
  const totalTools = agent.tools.length;

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-2 py-1.5 rounded-md border transition-colors',
        'bg-surface-1 hover:bg-surface-2 cursor-pointer',
        !agent.completed && 'border-primary/20',
        agent.completed && 'border-border/50',
      )}
      onClick={handleNavigate}
      role="button"
      tabIndex={0}
    >
      <span className="flex items-center justify-center w-4 h-4 shrink-0">
        {agent.completed ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-text-success" />
        ) : (
          <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
        )}
      </span>
      <Users className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      <span className="text-sm font-medium text-foreground truncate flex-1 min-w-0">
        {displayDescription}
      </span>
      {totalTools > 0 && (
        <span className="text-2xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono shrink-0">
          {completedTools}/{totalTools}
        </span>
      )}
      {agent.completed && agent.endTime ? (
        <span className="text-2xs text-muted-foreground/70 font-mono tabular-nums shrink-0">
          {((agent.endTime - agent.startTime) / 1000).toFixed(1)}s
        </span>
      ) : !agent.completed ? (
        <AgentElapsedTime startTime={agent.startTime} />
      ) : null}
      <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
    </div>
  );
});

function TeammateGroup({ teammates }: { teammates: readonly SubAgent[] }) {
  return (
    <div className="space-y-1 my-1">
      <div className="flex items-center gap-1.5 px-1.5">
        <Users className="w-3 h-3 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">
          Team ({teammates.length} teammate{teammates.length !== 1 ? 's' : ''})
        </span>
      </div>
      <div className="space-y-1 ml-1">
        {teammates.map(agent => (
          <TeammateCard key={agent.agentId} agent={agent} />
        ))}
      </div>
    </div>
  );
}

interface SubAgentGroupProps {
  subAgents: readonly SubAgent[];
  worktreePath?: string;
}

export const SubAgentGroup = memo(function SubAgentGroup({ subAgents, worktreePath }: SubAgentGroupProps) {
  if (subAgents.length === 0) return null;

  const teammates = subAgents.filter(a => a.agentType === 'teammate' || a.agentType === 'team_member');
  const regularAgents = subAgents.filter(a => a.agentType !== 'teammate' && a.agentType !== 'team_member');

  return (
    <div className="space-y-0.5">
      {teammates.length > 0 && (
        <TeammateGroup teammates={teammates} />
      )}
      {regularAgents.map((agent) => (
        <SubAgentRow key={agent.agentId} agent={agent} worktreePath={worktreePath} />
      ))}
    </div>
  );
});
