'use client';

import { useTerminal, type UseTerminalReturn } from '@/hooks/useTerminal';

export interface UseClaudeTerminalOptions {
  workspacePath?: string;
  onExit?: (code: number | null) => void;
}

export function useClaudeTerminal(options: UseClaudeTerminalOptions): UseTerminalReturn {
  return useTerminal({
    workspacePath: options.workspacePath,
    onExit: options.onExit,
    command: 'claude',
    commandArgs: [],
  });
}
