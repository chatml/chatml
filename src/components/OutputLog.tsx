'use client';

import { useEffect, useRef } from 'react';
import { useAppStore } from '@/stores/appStore';

interface OutputLogProps {
  agentId: string;
}

function getLineStyle(line: string): string {
  if (line.startsWith('💭')) return 'text-purple-400 italic';
  if (line.startsWith('🔧')) return 'text-yellow-400 font-medium';
  if (line.startsWith('✓')) return 'text-green-400';
  if (line.startsWith('⏳')) return 'text-blue-400';
  if (line.startsWith('✅')) return 'text-green-500 font-bold';
  if (line.startsWith('[stderr]')) return 'text-red-400';
  return 'text-gray-300';
}

export function OutputLog({ agentId }: OutputLogProps) {
  const agentOutputs = useAppStore((state) => state.agentOutputs);
  const output = agentOutputs[agentId] ?? [];
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [output]);

  return (
    <div
      ref={containerRef}
      className="bg-gray-900 rounded p-3 h-64 overflow-y-auto font-mono text-sm"
    >
      {output.length === 0 ? (
        <div className="flex items-center gap-2 text-gray-500">
          <span className="animate-pulse">●</span>
          Waiting for agent to start...
        </div>
      ) : (
        output.map((line, i) => (
          <div key={i} className={`py-0.5 ${getLineStyle(line)}`}>
            {line}
          </div>
        ))
      )}
    </div>
  );
}
