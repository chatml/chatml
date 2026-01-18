'use client';

import type { Agent } from '@/lib/types';
import { stopAgent, getAgentDiff, mergeAgent, deleteAgent } from '@/lib/api';
import { OutputLog } from './OutputLog';
import { useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Bot,
  Square,
  GitMerge,
  Trash2,
  FileCode,
  Terminal,
  ChevronDown,
  ChevronUp,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface AgentCardProps {
  agent: Agent;
  onRefresh: () => void;
}

const statusConfig = {
  pending: {
    icon: Clock,
    label: 'Pending',
    variant: 'secondary' as const,
  },
  running: {
    icon: Loader2,
    label: 'Running',
    variant: 'default' as const,
  },
  done: {
    icon: CheckCircle2,
    label: 'Completed',
    variant: 'secondary' as const,
  },
  error: {
    icon: XCircle,
    label: 'Failed',
    variant: 'destructive' as const,
  },
};

export function AgentCard({ agent, onRefresh }: AgentCardProps) {
  const [showDiff, setShowDiff] = useState(false);
  const [diff, setDiff] = useState('');
  const [expanded, setExpanded] = useState(true);
  const [activeTab, setActiveTab] = useState('output');
  const removeAgent = useAppStore((state) => state.removeAgent);

  const status = statusConfig[agent.status];
  const StatusIcon = status.icon;

  const handleStop = async () => {
    await stopAgent(agent.id);
    onRefresh();
  };

  const handleViewDiff = async () => {
    const d = await getAgentDiff(agent.id);
    setDiff(d);
    setShowDiff(true);
  };

  const handleMerge = async () => {
    await mergeAgent(agent.id);
    await deleteAgent(agent.id);
    removeAgent(agent.id);
    onRefresh();
  };

  const handleDiscard = async () => {
    await deleteAgent(agent.id);
    removeAgent(agent.id);
    onRefresh();
  };

  return (
    <>
      <Card className="mb-4">
        <CardHeader className="p-4 pb-0">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                <Bot className="w-5 h-5 text-muted-foreground" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm">
                    Agent {agent.id.slice(0, 8)}
                  </span>
                  <Badge variant={status.variant} className="gap-1">
                    <StatusIcon
                      className={cn(
                        'w-3 h-3',
                        agent.status === 'running' && 'animate-spin'
                      )}
                    />
                    {status.label}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                  {agent.task}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {agent.status === 'running' && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleStop}
                >
                  <Square className="w-3 h-3 mr-1.5" />
                  Stop
                </Button>
              )}
              {agent.status === 'done' && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleViewDiff}
                  >
                    <FileCode className="w-3 h-3 mr-1.5" />
                    Diff
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleMerge}
                  >
                    <GitMerge className="w-3 h-3 mr-1.5" />
                    Merge
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleDiscard}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </>
              )}
              {agent.status === 'error' && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDiscard}
                >
                  <Trash2 className="w-3 h-3 mr-1.5" />
                  Discard
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </Button>
            </div>
          </div>
        </CardHeader>

        {expanded && (
          <CardContent className="p-4 pt-3">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList>
                <TabsTrigger value="output" className="gap-1.5">
                  <Terminal className="w-3 h-3" />
                  Output
                </TabsTrigger>
                {agent.status === 'done' && (
                  <TabsTrigger value="changes" className="gap-1.5">
                    <FileCode className="w-3 h-3" />
                    Changes
                  </TabsTrigger>
                )}
              </TabsList>
              <TabsContent value="output" className="mt-3">
                <OutputLog agentId={agent.id} />
              </TabsContent>
              {agent.status === 'done' && (
                <TabsContent value="changes" className="mt-3">
                  <div className="rounded-lg border bg-muted/50 p-4 h-64">
                    <p className="text-muted-foreground text-sm">
                      Click &quot;Diff&quot; to view changes
                    </p>
                  </div>
                </TabsContent>
              )}
            </Tabs>
          </CardContent>
        )}
      </Card>

      {/* Diff Modal */}
      <Dialog open={showDiff} onOpenChange={setShowDiff}>
        <DialogContent className="max-w-4xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileCode className="w-5 h-5" />
              Changes from Agent {agent.id.slice(0, 8)}
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="flex-1 mt-4">
            <pre className="terminal rounded-lg border bg-muted/50 p-4 text-sm whitespace-pre-wrap">
              {diff || 'No changes'}
            </pre>
          </ScrollArea>
          <div className="flex justify-end gap-2 mt-4 pt-4 border-t">
            <Button variant="outline" onClick={() => setShowDiff(false)}>
              Close
            </Button>
            <Button
              onClick={() => {
                setShowDiff(false);
                handleMerge();
              }}
            >
              <GitMerge className="w-4 h-4 mr-2" />
              Merge Changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
