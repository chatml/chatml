'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardCheck, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { extractMarkers, type ConversationMarker } from '@/lib/conversationMarkers';
import type { Message } from '@/lib/types';

interface ConversationMarkersProps {
  messages: readonly Message[];
  onScrollToIndex: (index: number) => void;
}

export const ConversationMarkers = memo(function ConversationMarkers({
  messages,
  onScrollToIndex,
}: ConversationMarkersProps) {
  const markers = useMemo(() => extractMarkers(messages), [messages]);
  const totalMessages = messages.length;

  const [isOpen, setIsOpen] = useState(false);
  const [hoveredMarkerId, setHoveredMarkerId] = useState<string | null>(null);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (openTimerRef.current) clearTimeout(openTimerRef.current);
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);

  // Clean up timers on unmount
  useEffect(() => clearTimers, [clearTimers]);

  const handleTrackEnter = useCallback(() => {
    clearTimers();
    openTimerRef.current = setTimeout(() => setIsOpen(true), 150);
  }, [clearTimers]);

  const handleTrackLeave = useCallback(() => {
    clearTimers();
    closeTimerRef.current = setTimeout(() => {
      setIsOpen(false);
      setHoveredMarkerId(null);
    }, 200);
  }, [clearTimers]);

  const handlePopoverEnter = useCallback(() => {
    clearTimers();
    setIsOpen(true);
  }, [clearTimers]);

  const handlePopoverLeave = useCallback(() => {
    clearTimers();
    closeTimerRef.current = setTimeout(() => {
      setIsOpen(false);
      setHoveredMarkerId(null);
    }, 200);
  }, [clearTimers]);

  const handleMarkerClick = useCallback(
    (marker: ConversationMarker) => {
      onScrollToIndex(marker.index);
      setIsOpen(false);
    },
    [onScrollToIndex]
  );

  const hoveredMarker = useMemo(
    () => (hoveredMarkerId ? markers.find((m) => m.id === hoveredMarkerId) ?? null : null),
    [hoveredMarkerId, markers]
  );

  if (markers.length === 0) return null;

  return (
    <>
      {/* Marker track — narrow strip on right edge */}
      <div
        className="absolute top-0 right-0 bottom-0 w-3 z-[15] cursor-pointer"
        onMouseEnter={handleTrackEnter}
        onMouseLeave={handleTrackLeave}
      >
        {markers.map((marker) => {
          const topPercent =
            totalMessages <= 1
              ? 50
              : (marker.index / (totalMessages - 1)) * 100;

          return (
            <div
              key={marker.id}
              className={cn(
                'absolute right-0.5 h-[3px] w-[8px] rounded-full transition-opacity',
                marker.type === 'plan'
                  ? 'bg-brand/70'
                  : 'bg-muted-foreground/40'
              )}
              style={{ top: `${topPercent}%` }}
              onClick={() => handleMarkerClick(marker)}
            />
          );
        })}
      </div>

      {/* Hover popover — positioned to the left of the track */}
      {isOpen && (
        <div
          className="absolute top-0 right-3 bottom-0 z-[16] flex items-start pointer-events-none"
        >
          <div
            className={cn(
              'pointer-events-auto mt-8 flex max-h-[calc(100%-4rem)]',
              'rounded-md border bg-popover text-popover-foreground shadow-lg',
              'animate-in fade-in-0 zoom-in-95 duration-150'
            )}
            onMouseEnter={handlePopoverEnter}
            onMouseLeave={handlePopoverLeave}
          >
            {/* Left panel: preview of hovered item */}
            {hoveredMarker && (
              <div className="w-48 border-r p-3 text-xs text-muted-foreground overflow-hidden">
                <div className="flex items-center gap-1.5 mb-2 text-[10px] uppercase tracking-wider font-medium">
                  {hoveredMarker.type === 'plan' ? (
                    <>
                      <ClipboardCheck className="w-3 h-3" />
                      Plan
                    </>
                  ) : (
                    <>
                      <User className="w-3 h-3" />
                      User
                    </>
                  )}
                </div>
                <p className="leading-relaxed line-clamp-[12]">
                  {hoveredMarker.title}
                </p>
              </div>
            )}

            {/* Right panel: marker list */}
            <div className="w-56 overflow-y-auto py-1">
              {markers.map((marker) => (
                <button
                  key={marker.id}
                  className={cn(
                    'flex items-center gap-2 w-full px-3 py-1.5 text-left text-xs',
                    'hover:bg-accent transition-colors cursor-pointer',
                    hoveredMarkerId === marker.id && 'bg-accent'
                  )}
                  onClick={() => handleMarkerClick(marker)}
                  onMouseEnter={() => setHoveredMarkerId(marker.id)}
                >
                  {marker.type === 'plan' ? (
                    <ClipboardCheck className="w-3 h-3 shrink-0 text-brand" />
                  ) : (
                    <User className="w-3 h-3 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate">{marker.title}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
});
