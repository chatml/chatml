'use client';

import { useAppStore } from '@/stores/appStore';
import { ScrollArea } from '@/components/ui/scroll-area';
import { EmptyState } from '@/components/ui/empty-state';
import { FileText, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface PlanDocument {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  status?: 'draft' | 'active' | 'completed';
}

export function PlansPanel() {
  const { selectedSessionId } = useAppStore();

  // TODO: Fetch plans from session/conversation
  const plans: PlanDocument[] = [];

  if (plans.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <EmptyState
          icon={FileText}
          title="No plans yet"
          description="Plans will appear when the agent creates them"
        />
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="py-1 px-2 space-y-1">
        {plans.map((plan) => (
          <PlanRow key={plan.id} plan={plan} />
        ))}
      </div>
    </ScrollArea>
  );
}

function PlanRow({ plan }: { plan: PlanDocument }) {
  const statusColors = {
    draft: 'text-muted-foreground',
    active: 'text-blue-500',
    completed: 'text-green-500',
  };

  return (
    <div
      className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/50 cursor-pointer group"
    >
      <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{plan.name}</div>
        <div className="text-xs text-muted-foreground truncate">{plan.path}</div>
      </div>
      {plan.status && (
        <span className={cn('text-xs capitalize', statusColors[plan.status])}>
          {plan.status}
        </span>
      )}
      <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
    </div>
  );
}
