'use client';

import { memo } from 'react';
import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react';

export const DataFlowEdge = memo(function DataFlowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  data,
}: EdgeProps) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const isConditionalFalse = data?.label === 'false';

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          strokeWidth: selected ? 2.5 : 1.5,
          stroke: isConditionalFalse
            ? 'var(--color-destructive)'
            : selected
              ? 'var(--color-primary)'
              : 'var(--color-border)',
        }}
      />
      {data?.label && (
        <text>
          <textPath
            href={`#${id}`}
            startOffset="50%"
            textAnchor="middle"
            className="text-[10px] fill-muted-foreground"
            dy={-8}
          >
            {String(data.label)}
          </textPath>
        </text>
      )}
    </>
  );
});
