'use client';

import type { DashboardAlert } from './useDashboardData';
import { cn } from '@/lib/utils';
import {
  AlertTriangle,
  XCircle,
  AlertCircle,
  ArrowRight,
} from 'lucide-react';

interface AlertsSectionProps {
  alerts: DashboardAlert[];
  onAlertClick: (sessionId: string) => void;
}

export function AlertsSection({ alerts, onAlertClick }: AlertsSectionProps) {
  if (alerts.length === 0) {
    return null;
  }

  const getAlertIcon = (type: DashboardAlert['type']) => {
    switch (type) {
      case 'error':
        return AlertCircle;
      case 'check_failure':
        return XCircle;
      case 'merge_conflict':
        return AlertTriangle;
    }
  };

  const getAlertStyles = (alert: DashboardAlert) => {
    if (alert.severity === 'error') {
      return {
        bg: 'bg-red-500/10 hover:bg-red-500/20',
        border: 'border-red-500/20',
        icon: 'text-red-500',
        text: 'text-red-500',
      };
    }
    // warning
    return {
      bg: 'bg-yellow-500/10 hover:bg-yellow-500/20',
      border: 'border-yellow-500/20',
      icon: 'text-yellow-500',
      text: 'text-yellow-500',
    };
  };

  return (
    <div className="space-y-2">
      <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Needs Attention
      </h2>
      <div className="space-y-1.5">
        {alerts.map((alert, index) => {
          const Icon = getAlertIcon(alert.type);
          const styles = getAlertStyles(alert);

          return (
            <button
              key={`${alert.sessionId}-${alert.type}-${index}`}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-colors',
                styles.bg,
                styles.border
              )}
              onClick={() => onAlertClick(alert.sessionId)}
            >
              <Icon className={cn('h-4 w-4 shrink-0', styles.icon)} />
              <span className={cn('text-sm flex-1', styles.text)}>
                {alert.message}
              </span>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
