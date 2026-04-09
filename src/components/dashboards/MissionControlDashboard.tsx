'use client';

import { useMemo } from 'react';
import { FullContentLayout } from '@/components/layout/FullContentLayout';
import { useMainToolbarContent } from '@/hooks/useMainToolbarContent';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAuthStore } from '@/stores/authStore';
import { AttentionQueue, LiveActivity, SpendTracker } from './mission-control';
import { LayoutDashboard } from 'lucide-react';

export function MissionControlDashboard() {
  const user = useAuthStore((s) => s.user);

  const greeting = (() => {
    const hour = new Date().getHours();
    let timeGreeting: string;
    if (hour < 12) timeGreeting = 'Good morning';
    else if (hour < 17) timeGreeting = 'Good afternoon';
    else timeGreeting = 'Good evening';

    // Extract first name from GitHub profile name, fall back to login
    const fullName = user?.name || user?.login;
    const firstName = fullName?.split(' ')[0];

    return firstName ? `${timeGreeting}, ${firstName}` : timeGreeting;
  })();

  const toolbarConfig = useMemo(() => ({
    leading: null,
    title: (
      <div className="flex items-center gap-2">
        <LayoutDashboard className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-semibold">Dashboard</span>
      </div>
    ),
    titlePosition: 'left' as const,
    actions: null,
  }), []);

  useMainToolbarContent(toolbarConfig);

  return (
    <FullContentLayout>
      <ScrollArea className="h-full">
        <div className="max-w-5xl mx-auto px-6 py-6 space-y-8">
          <h1 className="text-2xl font-semibold text-foreground">{greeting}</h1>
          <AttentionQueue />
          <LiveActivity />
          <SpendTracker />
        </div>
      </ScrollArea>
    </FullContentLayout>
  );
}
