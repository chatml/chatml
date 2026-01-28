'use client';

import { useEffect, useRef, useMemo } from 'react';
import { useAppStore } from '@/stores/appStore';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import {
  Lightbulb,
  Wrench,
  CheckCircle,
  Clock,
  CheckCheck,
  AlertCircle,
} from 'lucide-react';

interface OutputLogProps {
  agentId: string;
}

function getLineConfig(line: string): {
  icon: typeof Lightbulb | null;
  className: string;
} {
  if (line.startsWith('💭')) {
    return { icon: Lightbulb, className: 'text-primary' };
  }
  if (line.startsWith('🔧')) {
    return { icon: Wrench, className: 'text-text-warning' };
  }
  if (line.startsWith('✓')) {
    return { icon: CheckCircle, className: 'text-text-success' };
  }
  if (line.startsWith('⏳')) {
    return { icon: Clock, className: 'text-text-info' };
  }
  if (line.startsWith('✅')) {
    return { icon: CheckCheck, className: 'text-text-success font-medium' };
  }
  if (line.startsWith('[stderr]')) {
    return { icon: AlertCircle, className: 'text-text-error' };
  }
  return { icon: null, className: 'text-muted-foreground' };
}

function stripEmoji(line: string): string {
  return line.replace(/^[💭🔧✓⏳✅]\s*/, '').replace(/^\[stderr\]\s*/, '');
}

export function OutputLog({ agentId }: OutputLogProps) {
  const agentOutputs = useAppStore((state) => state.agentOutputs);
  const output = useMemo(() => agentOutputs[agentId] ?? [], [agentOutputs, agentId]);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [output]);

  return (
    <div
      ref={containerRef}
      className="rounded-lg border bg-muted/30 h-64 overflow-hidden"
    >
      <ScrollArea className="h-full">
        <div className="p-3 terminal">
          {output.length === 0 ? (
            <div className="flex items-center gap-2 text-muted-foreground py-4">
              <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              <span className="text-sm">Waiting for output...</span>
            </div>
          ) : (
            output.map((line, i) => {
              const config = getLineConfig(line);
              const Icon = config.icon;
              const cleanLine = Icon ? stripEmoji(line) : line;

              return (
                <div
                  key={i}
                  className={cn(
                    'flex items-start gap-2 py-0.5',
                    config.className
                  )}
                >
                  {Icon && (
                    <Icon className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  )}
                  <span className="break-all">{cleanLine}</span>
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
