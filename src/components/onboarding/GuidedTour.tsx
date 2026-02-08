'use client';

import { useEffect } from 'react';
import { GuidedTourTooltip } from './GuidedTourTooltip';
import { useAppStore } from '@/stores/appStore';

interface GuidedTourProps {
  onComplete: () => void;
  onDismiss: () => void;
}

export function GuidedTour({ onComplete, onDismiss }: GuidedTourProps) {
  const workspaces = useAppStore((s) => s.workspaces);

  // Auto-complete when user adds a workspace
  useEffect(() => {
    if (workspaces.length > 0) {
      onComplete();
    }
  }, [workspaces.length, onComplete]);

  return (
    <GuidedTourTooltip
      targetSelector='[data-tour-target="add-workspace"]'
      description="Click here to open a project and get started with your first session."
      onDismiss={onDismiss}
    />
  );
}
