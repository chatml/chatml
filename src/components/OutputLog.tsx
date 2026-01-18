'use client';

import { useEffect, useRef } from 'react';
import { useAppStore } from '@/stores/appStore';

interface OutputLogProps {
  agentId: string;
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
      className="bg-gray-900 rounded p-3 h-48 overflow-y-auto font-mono text-sm"
    >
      {output.length === 0 ? (
        <span className="text-gray-500">Waiting for output...</span>
      ) : (
        output.map((line, i) => (
          <div key={i} className="text-gray-300">
            {line}
          </div>
        ))
      )}
    </div>
  );
}
