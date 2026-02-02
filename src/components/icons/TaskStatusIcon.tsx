import type { SessionTaskStatus } from '@/lib/types';

interface TaskStatusIconProps {
  status: SessionTaskStatus;
  className?: string;
}

// Linear-style status icons as inline SVGs
export function TaskStatusIcon({ status, className = 'h-3.5 w-3.5' }: TaskStatusIconProps) {
  switch (status) {
    case 'backlog':
      return (
        <svg viewBox="0 0 16 16" fill="none" className={className}>
          <circle
            cx="8"
            cy="8"
            r="6.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeDasharray="3 2.5"
            className="text-muted-foreground"
          />
        </svg>
      );

    case 'in_progress':
      return (
        <svg viewBox="0 0 16 16" fill="none" className={className}>
          <circle
            cx="8"
            cy="8"
            r="6.5"
            stroke="#EAB308"
            strokeWidth="1.5"
          />
          <path
            d="M8 1.5A6.5 6.5 0 0 1 14.5 8H8V1.5Z"
            fill="#EAB308"
          />
        </svg>
      );

    case 'in_review':
      return (
        <svg viewBox="0 0 16 16" fill="none" className={className}>
          <circle
            cx="8"
            cy="8"
            r="6.5"
            stroke="#22C55E"
            strokeWidth="1.5"
          />
          <path
            d="M8 1.5A6.5 6.5 0 0 1 14.5 8 6.5 6.5 0 0 1 8 14.5 6.5 6.5 0 0 1 1.5 8H8V1.5Z"
            fill="#22C55E"
          />
        </svg>
      );

    case 'done':
      return (
        <svg viewBox="0 0 16 16" fill="none" className={className}>
          <circle cx="8" cy="8" r="7" fill="#A855F7" />
          <path
            d="M5.5 8L7.2 9.7L10.5 6.3"
            stroke="white"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );

    case 'cancelled':
      return (
        <svg viewBox="0 0 16 16" fill="none" className={className}>
          <circle
            cx="8"
            cy="8"
            r="6.5"
            stroke="currentColor"
            strokeWidth="1.5"
            className="text-muted-foreground/50"
          />
          <path
            d="M5.75 5.75L10.25 10.25M10.25 5.75L5.75 10.25"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            className="text-muted-foreground/50"
          />
        </svg>
      );

    default:
      return (
        <svg viewBox="0 0 16 16" fill="none" className={className}>
          <circle
            cx="8"
            cy="8"
            r="6.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeDasharray="3 2.5"
            className="text-muted-foreground"
          />
        </svg>
      );
  }
}
