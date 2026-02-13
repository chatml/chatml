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
} from 'lucide-react';
import { cn } from '@/lib/utils';
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
        {agent.description ? (
          <span className="text-muted-foreground italic truncate max-w-[300px]">
            {agent.description}
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

interface SubAgentGroupProps {
  subAgents: readonly SubAgent[];
  worktreePath?: string;
}

export const SubAgentGroup = memo(function SubAgentGroup({ subAgents, worktreePath }: SubAgentGroupProps) {
  if (subAgents.length === 0) return null;

  return (
    <div className="space-y-0.5">
      {subAgents.map((agent) => (
        <SubAgentRow key={agent.agentId} agent={agent} worktreePath={worktreePath} />
      ))}
    </div>
  );
});
