import { Code, Terminal, FolderOpen } from 'lucide-react';
import type { AppCategory } from '@/lib/openApps';

interface IconProps {
  className?: string;
}

function VSCodeIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M17.5 2L9 11.5l-5-4-2 1.5L7.5 14 2 19l2 1.5 5-4L17.5 22l4.5-2V4L17.5 2zM17 17.5L10 12l7-5.5v11z"
        fill="#007ACC"
      />
    </svg>
  );
}

function CursorIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <rect x="2" y="2" width="20" height="20" rx="4" fill="#1A1A2E" />
      <path
        d="M7 12h10M12 7v10"
        stroke="#00D4FF"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ZedIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M4 6h16L8 18h12"
        stroke="#A855F7"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function WindsurfIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M4 18C4 18 7 8 12 6s8 12 8 12"
        stroke="#10B981"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M4 14c3-4 6-6 8-6s5 2 8 6"
        stroke="#10B981"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.6"
      />
    </svg>
  );
}

function SublimeIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M4 8l16-4v5L4 13V8z" fill="#FF9800" />
      <path d="M4 11l16 4v5L4 16v-5z" fill="#FF9800" opacity="0.7" />
    </svg>
  );
}

function TerminalAppIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <rect x="2" y="3" width="20" height="18" rx="3" fill="#1C1C1E" />
      <path
        d="M6 15l4-3-4-3"
        stroke="#00FF00"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line x1="12" y1="15" x2="18" y2="15" stroke="#00FF00" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ITerm2Icon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <rect x="2" y="3" width="20" height="18" rx="3" fill="#000" />
      <path
        d="M6 15l4-3-4-3"
        stroke="#34D058"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line x1="12" y1="15" x2="18" y2="15" stroke="#34D058" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function WarpIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <rect x="2" y="3" width="20" height="18" rx="3" fill="#0A0E1A" />
      <path
        d="M8 9l4 3-4 3M13 9l4 3-4 3"
        stroke="#01A4FF"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FinderIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <rect x="2" y="2" width="20" height="20" rx="4" fill="#4A90D9" />
      <circle cx="9" cy="10" r="1.5" fill="white" />
      <circle cx="15" cy="10" r="1.5" fill="white" />
      <path
        d="M8 15c1.5 2 6.5 2 8 0"
        stroke="white"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export const APP_ICON_MAP: Record<string, React.ComponentType<IconProps>> = {
  vscode: VSCodeIcon,
  cursor: CursorIcon,
  zed: ZedIcon,
  windsurf: WindsurfIcon,
  sublime: SublimeIcon,
  terminal: TerminalAppIcon,
  iterm2: ITerm2Icon,
  warp: WarpIcon,
  finder: FinderIcon,
};

const CATEGORY_FALLBACK_ICON: Record<AppCategory, React.ComponentType<IconProps>> = {
  'editor': Code,
  'terminal': Terminal,
  'file-manager': FolderOpen,
};

export function getAppIcon(appId: string, category: AppCategory): React.ComponentType<IconProps> {
  return APP_ICON_MAP[appId] ?? CATEGORY_FALLBACK_ICON[category];
}
