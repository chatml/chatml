'use client';

import { Folder, Globe, SquarePlus, Sparkles } from 'lucide-react';

interface EmptyViewProps {
  onOpenProject: () => void;
  onCloneFromUrl: () => void;
  onQuickStart: () => void;
}

const ACTION_CARDS = [
  { icon: Folder, label: 'Open project', key: 'open' },
  { icon: Globe, label: 'Clone from URL', key: 'clone' },
  { icon: SquarePlus, label: 'Quick start', key: 'quickstart' },
] as const;

export function EmptyView({ onOpenProject, onCloneFromUrl, onQuickStart }: EmptyViewProps) {
  const handleCardClick = (key: string) => {
    switch (key) {
      case 'open':
        onOpenProject();
        break;
      case 'clone':
        onCloneFromUrl();
        break;
      case 'quickstart':
        onQuickStart();
        break;
    }
  };

  return (
    <div className="h-full flex flex-col items-center justify-center bg-background">
      {/* Logo */}
      <div className="mb-12">
        <div className="relative">
          {/* Glow effect */}
          <div className="absolute inset-0 bg-gradient-to-br from-primary to-purple-500 rounded-2xl blur-xl opacity-30" />
          {/* Logo */}
          <div className="relative flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-purple-500 shadow-lg">
            <Sparkles className="h-10 w-10 text-white" />
          </div>
        </div>
      </div>

      {/* Action Cards */}
      <div className="flex gap-4">
        {ACTION_CARDS.map(({ icon: Icon, label, key }) => (
          <button
            key={key}
            onClick={() => handleCardClick(key)}
            className="group flex flex-col w-40 h-28 p-4 rounded-xl border border-border/50 bg-card/50 hover:bg-card hover:border-border transition-all duration-200"
          >
            <Icon className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors" />
            <span className="mt-auto text-sm text-muted-foreground group-hover:text-foreground transition-colors">
              {label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
