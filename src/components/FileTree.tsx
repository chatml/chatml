'use client';

import { useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isTauri } from '@/lib/tauri';

export interface FileNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: FileNode[];
}

interface FileTreeProps {
  files: FileNode[];
  onFileSelect?: (path: string) => void;
  workspacePath?: string;
  workspaceName?: string;
}

export function FileTree({ files, onFileSelect, workspacePath, workspaceName }: FileTreeProps) {
  const handleOpenInVSCode = async () => {
    if (!workspacePath || !isTauri()) return;
    try {
      const { Command } = await import('@tauri-apps/plugin-shell');
      Command.create('code', [workspacePath]).spawn().catch(console.error);
    } catch (e) {
      console.error('Failed to open in VS Code:', e);
    }
  };

  // Truncate path for display, showing the last part
  const displayPath = workspacePath
    ? workspacePath.length > 35
      ? '...' + workspacePath.slice(-32)
      : workspacePath
    : workspaceName || 'Files';

  return (
    <div className="h-full flex flex-col">
      {/* Header bar with path and VS Code link */}
      <div className="flex items-center gap-2 px-2 py-1.5 border-b bg-muted/30 shrink-0 min-h-[28px]">
        <span className="text-[10px] text-muted-foreground truncate flex-1" title={workspacePath}>
          {displayPath}
        </span>
        <button
          onClick={handleOpenInVSCode}
          className="text-[10px] text-primary/70 hover:text-primary transition-colors shrink-0"
          title="⌘⇧O"
        >
          Open in VSCode
        </button>
      </div>

      {/* File tree content */}
      <ScrollArea className="flex-1">
        <div className="py-1">
          {files.map((node) => (
            <FileTreeNode
              key={node.path}
              node={node}
              depth={0}
              onFileSelect={onFileSelect}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

interface FileTreeNodeProps {
  node: FileNode;
  depth: number;
  onFileSelect?: (path: string) => void;
}

function FileTreeNode({ node, depth, onFileSelect }: FileTreeNodeProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const handleClick = () => {
    if (node.isDir) {
      setIsExpanded(!isExpanded);
    } else {
      onFileSelect?.(node.path);
    }
  };

  const isHidden = node.name.startsWith('.');

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-1.5 py-px px-1 hover:bg-accent/50 cursor-pointer text-[11px]',
          'transition-colors',
          isHidden && 'text-muted-foreground/75'
        )}
        style={{ paddingLeft: `${depth * 8 + 4}px` }}
        onClick={handleClick}
      >
        {node.isDir ? (
          <>
            {isExpanded ? (
              <ChevronDown className="w-2.5 h-2.5 text-muted-foreground shrink-0" />
            ) : (
              <ChevronRight className="w-2.5 h-2.5 text-muted-foreground shrink-0" />
            )}
            {isExpanded ? (
              <FolderOpenIcon className={cn("w-3 h-3 shrink-0", isHidden ? "text-amber-500/50" : "text-amber-500")} />
            ) : (
              <FolderIcon className={cn("w-3 h-3 shrink-0", isHidden ? "text-amber-500/50" : "text-amber-500")} />
            )}
          </>
        ) : (
          <>
            <span className="w-2.5" /> {/* Spacer for alignment */}
            <FileIcon filename={node.name} />
          </>
        )}
        <span className="truncate">{node.name}</span>
      </div>
      {node.isDir && isExpanded && node.children && (
        <div>
          {node.children.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              onFileSelect={onFileSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Filled folder icons
function FolderIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z" />
    </svg>
  );
}

function FolderOpenIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M4 4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2H4z" />
      <path d="M2 10h20v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8z" fillOpacity="0.3" />
    </svg>
  );
}

// File icon component based on file extension
function FileIcon({ filename }: { filename: string }) {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const name = filename.toLowerCase();

  // Get icon color and text based on file type
  const getIconStyle = (): { color: string; text: string } => {
    // Special files
    if (name === '.gitignore') return { color: 'text-orange-500', text: '' };
    if (name === '.dockerignore') return { color: 'text-blue-400', text: '' };
    if (name === '.env' || name.startsWith('.env.')) return { color: 'text-yellow-500', text: '' };
    if (name === 'dockerfile' || name.endsWith('.dockerfile')) return { color: 'text-blue-500', text: '' };
    if (name === 'makefile') return { color: 'text-orange-400', text: '' };
    if (name === 'readme.md') return { color: 'text-blue-400', text: '' };
    if (name === 'license' || name === 'license.md') return { color: 'text-yellow-400', text: '' };

    // By extension
    switch (ext) {
      // JavaScript/TypeScript
      case 'js':
        return { color: 'text-yellow-400', text: 'JS' };
      case 'jsx':
        return { color: 'text-cyan-400', text: 'JSX' };
      case 'ts':
        return { color: 'text-blue-500', text: 'TS' };
      case 'tsx':
        return { color: 'text-blue-400', text: 'TSX' };
      case 'mjs':
      case 'cjs':
        return { color: 'text-yellow-500', text: 'JS' };

      // Web
      case 'html':
        return { color: 'text-orange-500', text: '' };
      case 'css':
        return { color: 'text-blue-500', text: '' };
      case 'scss':
      case 'sass':
        return { color: 'text-pink-500', text: '' };
      case 'less':
        return { color: 'text-indigo-400', text: '' };

      // Data/Config
      case 'json':
        return { color: 'text-yellow-500', text: '{}' };
      case 'yaml':
      case 'yml':
        return { color: 'text-red-400', text: '' };
      case 'toml':
        return { color: 'text-gray-400', text: '' };
      case 'xml':
        return { color: 'text-orange-400', text: '' };
      case 'env':
        return { color: 'text-yellow-500', text: '' };

      // Documentation
      case 'md':
      case 'mdx':
        return { color: 'text-blue-400', text: '' };
      case 'txt':
        return { color: 'text-gray-400', text: '' };
      case 'pdf':
        return { color: 'text-red-500', text: '' };

      // Programming languages
      case 'go':
        return { color: 'text-cyan-500', text: 'GO' };
      case 'py':
        return { color: 'text-yellow-500', text: '' };
      case 'rb':
        return { color: 'text-red-500', text: '' };
      case 'rs':
        return { color: 'text-orange-500', text: '' };
      case 'java':
        return { color: 'text-red-400', text: '' };
      case 'kt':
      case 'kts':
        return { color: 'text-purple-400', text: '' };
      case 'swift':
        return { color: 'text-orange-500', text: '' };
      case 'c':
      case 'h':
        return { color: 'text-blue-500', text: 'C' };
      case 'cpp':
      case 'cc':
      case 'hpp':
        return { color: 'text-blue-400', text: 'C++' };
      case 'cs':
        return { color: 'text-purple-500', text: 'C#' };
      case 'php':
        return { color: 'text-indigo-400', text: '' };

      // Shell
      case 'sh':
      case 'bash':
      case 'zsh':
        return { color: 'text-green-500', text: '' };
      case 'ps1':
        return { color: 'text-blue-500', text: '' };

      // Images
      case 'png':
      case 'jpg':
      case 'jpeg':
      case 'gif':
      case 'svg':
      case 'ico':
      case 'webp':
        return { color: 'text-purple-400', text: '' };

      // Fonts
      case 'ttf':
      case 'otf':
      case 'woff':
      case 'woff2':
        return { color: 'text-red-300', text: '' };

      // Lock files
      case 'lock':
        return { color: 'text-gray-500', text: '' };

      // Git
      case 'gitignore':
        return { color: 'text-orange-500', text: '' };

      default:
        return { color: 'text-gray-400', text: '' };
    }
  };

  const style = getIconStyle();

  return (
    <div className={cn('w-3 h-3 flex items-center justify-center shrink-0', style.color)}>
      {style.text ? (
        <span className="text-[6px] font-semibold">{style.text}</span>
      ) : (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-3 h-3"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
      )}
    </div>
  );
}
