'use client';

import { cn } from '@/lib/utils';

interface FileTabIconProps {
  filename: string;
  className?: string;
}

export function FileTabIcon({ filename, className }: FileTabIconProps) {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const name = filename.toLowerCase();

  const getIconStyle = (): { color: string; text: string } => {
    // Special files
    if (name === '.gitignore') return { color: 'text-orange-500', text: '' };
    if (name === '.dockerignore') return { color: 'text-blue-400', text: '' };
    if (name === '.env' || name.startsWith('.env.')) return { color: 'text-yellow-500', text: '' };
    if (name === 'dockerfile' || name.endsWith('.dockerfile')) return { color: 'text-blue-500', text: '' };
    if (name === 'makefile') return { color: 'text-orange-400', text: '' };
    if (name === 'readme.md') return { color: 'text-blue-400', text: '' };

    switch (ext) {
      case 'js': return { color: 'text-yellow-400', text: 'JS' };
      case 'jsx': return { color: 'text-cyan-400', text: 'JSX' };
      case 'ts': return { color: 'text-blue-500', text: 'TS' };
      case 'tsx': return { color: 'text-blue-400', text: 'TSX' };
      case 'json': return { color: 'text-yellow-500', text: '{}' };
      case 'yaml':
      case 'yml': return { color: 'text-red-400', text: '' };
      case 'md':
      case 'mdx': return { color: 'text-blue-400', text: '' };
      case 'go': return { color: 'text-cyan-500', text: 'GO' };
      case 'py': return { color: 'text-yellow-500', text: '' };
      case 'rs': return { color: 'text-orange-500', text: '' };
      case 'html': return { color: 'text-orange-500', text: '' };
      case 'css': return { color: 'text-blue-500', text: '' };
      case 'scss': return { color: 'text-pink-500', text: '' };
      default: return { color: 'text-gray-400', text: '' };
    }
  };

  const style = getIconStyle();

  return (
    <div className={cn('w-3.5 h-3.5 flex items-center justify-center shrink-0', style.color, className)}>
      {style.text ? (
        <span className="text-[7px] font-bold">{style.text}</span>
      ) : (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-3.5 h-3.5"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
      )}
    </div>
  );
}
