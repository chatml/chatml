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
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const clearTimers = useCallback(() => {
    if (openTimerRef.current) clearTimeout(openTimerRef.current);
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  // Scroll focused item into view
  useEffect(() => {
    if (focusedIndex >= 0 && listRef.current) {
      const items = listRef.current.querySelectorAll('[role="option"]');
      items[focusedIndex]?.scrollIntoView({ block: 'nearest' });
    }
  }, [focusedIndex]);

  const handleTrackEnter = useCallback(() => {
    clearTimers();
    openTimerRef.current = setTimeout(() => setIsOpen(true), 150);
  }, [clearTimers]);

  const handleTrackLeave = useCallback(() => {
    clearTimers();
    closeTimerRef.current = setTimeout(() => {
      setIsOpen(false);
      setHoveredMarkerId(null);
      setFocusedIndex(-1);
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
      setFocusedIndex(-1);
    }, 200);
  }, [clearTimers]);

  const handleMarkerClick = useCallback(
    (marker: ConversationMarker) => {
      onScrollToIndex(marker.index);
      setIsOpen(false);
      setFocusedIndex(-1);
    },
    [onScrollToIndex]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (markers.length === 0) return;

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          const next = focusedIndex < markers.length - 1 ? focusedIndex + 1 : 0;
          setFocusedIndex(next);
          setHoveredMarkerId(markers[next].id);
          if (!isOpen) setIsOpen(true);
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          const prev = focusedIndex > 0 ? focusedIndex - 1 : markers.length - 1;
          setFocusedIndex(prev);
          setHoveredMarkerId(markers[prev].id);
          if (!isOpen) setIsOpen(true);
          break;
        }
        case 'Enter': {
          e.preventDefault();
          if (focusedIndex >= 0 && focusedIndex < markers.length) {
            handleMarkerClick(markers[focusedIndex]);
          }
          break;
        }
        case 'Escape': {
          e.preventDefault();
          setIsOpen(false);
          setHoveredMarkerId(null);
          setFocusedIndex(-1);
          trackRef.current?.blur();
          break;
        }
      }
    },
    [markers, focusedIndex, isOpen, handleMarkerClick]
  );

  const hoveredMarker = useMemo(
    () => (hoveredMarkerId ? markers.find((m) => m.id === hoveredMarkerId) ?? null : null),
    [hoveredMarkerId, markers]
  );

  const trackHeight = useMemo(
    () => Math.max(32, Math.min(markers.length * 8 + 16, 200)),
    [markers.length]
  );

  if (markers.length === 0) return null;

  return (
    <div className="absolute top-3 right-5 z-[15] pointer-events-none">
      {/* Marker track — compact minimap in top-right corner */}
      <div
        ref={trackRef}
        className="relative w-4 rounded-sm bg-muted/30 border border-border/30 cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-ring pointer-events-auto"
        style={{ height: trackHeight }}
        tabIndex={0}
        role="navigation"
        aria-label="Conversation markers"
        onMouseEnter={handleTrackEnter}
        onMouseLeave={handleTrackLeave}
        onKeyDown={handleKeyDown}
      >
        <div className="absolute inset-x-0 top-2 bottom-2">
          {markers.map((marker) => {
            const topPercent =
              totalMessages <= 1
                ? 50
                : (marker.index / (totalMessages - 1)) * 100;

            return (
              <div
                key={marker.id}
                className={cn(
                  'absolute left-1/2 -translate-x-1/2 h-[3px] w-[10px] rounded-full transition-opacity',
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
      </div>

      {/* Popover — always mounted, visibility toggled */}
      <div
        className={cn(
          'absolute top-0 right-full mr-2 transition-all duration-150 ease-out motion-reduce:transition-none',
          isOpen
            ? 'opacity-100 translate-x-0 pointer-events-auto'
            : 'opacity-0 translate-x-2 pointer-events-none'
        )}
        onMouseEnter={handlePopoverEnter}
        onMouseLeave={handlePopoverLeave}
      >
        <div
          className={cn(
            'flex max-h-[60vh]',
            'rounded-lg border bg-popover/95 backdrop-blur-md text-popover-foreground shadow-lg'
          )}
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
          <div
            ref={listRef}
            className="w-56 overflow-y-auto py-1 scrollbar-thin"
            role="listbox"
            aria-label="Conversation markers"
            aria-activedescendant={focusedIndex >= 0 ? markers[focusedIndex]?.id : undefined}
          >
            {markers.map((marker, i) => (
              <button
                key={marker.id}
                id={marker.id}
                role="option"
                aria-selected={focusedIndex === i}
                className={cn(
                  'flex items-center gap-2 w-full px-3 py-1.5 text-left text-xs',
                  'hover:bg-accent transition-colors cursor-pointer',
                  (hoveredMarkerId === marker.id || focusedIndex === i) && 'bg-accent'
                )}
                onClick={() => handleMarkerClick(marker)}
                onMouseEnter={() => {
                  setHoveredMarkerId(marker.id);
                  setFocusedIndex(i);
                }}
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
    </div>
  );
});
