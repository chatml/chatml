'use client';

import { useState, useCallback, useMemo, memo } from 'react';
import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Copy, Check, FileText, ChevronDown, ChevronRight, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Message, ToolUsage } from '@/lib/types';
import { COPY_FEEDBACK_DURATION_MS, PROSE_CLASSES } from '@/lib/constants';
import { copyToClipboard } from '@/lib/tauri';
import { ToolUsageBlock } from '@/components/conversation/ToolUsageBlock';
import { ThinkingNode } from '@/components/conversation/ThinkingNode';
import { VerificationBlock } from '@/components/conversation/VerificationBlock';
import { FileChangesBlock } from '@/components/conversation/FileChangesBlock';
import { RunSummaryBlock } from '@/components/conversation/RunSummaryBlock';
import { SystemInfoCard } from '@/components/shared/SystemInfoCard';
import { CachedMarkdown } from '@/components/shared/CachedMarkdown';
import { highlightSearchMatches } from '@/components/conversation/ChatSearchBar';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { InlineErrorFallback } from '@/components/shared/ErrorFallbacks';
import { AttachmentGrid } from '@/components/conversation/AttachmentGrid';
import { AttachmentPreviewModal } from '@/components/conversation/AttachmentPreviewModal';
import { MentionText } from '@/components/conversation/MentionText';
import { ApprovedPlanBlock } from '@/components/conversation/ApprovedPlanBlock';
import { TurnStatusIndicator } from '@/components/conversation/TurnStatusIndicator';
import { MessageTokenFooter } from '@/components/conversation/MessageTokenFooter';

// Collapsed tool summary with individual ToolUsageBlock instances when expanded
const ToolUsageSummary = memo(function ToolUsageSummary({ tools, worktreePath, conversationId, messageId, compacted }: { tools: ToolUsage[]; worktreePath?: string; conversationId?: string; messageId?: string; compacted?: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  if (tools.length === 0) return null;

  const successCount = tools.filter(t => t.success !== false).length;
  const failCount = tools.filter(t => t.success === false).length;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
        {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <Wrench className="w-3 h-3" />
        <span>{tools.length} tool{tools.length !== 1 ? 's' : ''}</span>
        {successCount > 0 && <span className="text-text-success">{successCount} passed</span>}
        {failCount > 0 && <span className="text-destructive">{failCount} failed</span>}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 space-y-0.5">
          {tools.map(tool => (
            <ToolUsageBlock
              key={tool.id}
              id={tool.id}
              tool={tool.tool}
              params={tool.params}
              worktreePath={worktreePath}
              isActive={false}
              success={tool.success}
              summary={tool.summary}
              duration={tool.durationMs}
              stdout={tool.stdout}
              stderr={tool.stderr}
              metadata={tool.metadata}
              conversationId={conversationId}
              messageId={messageId}
              compacted={compacted}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
});

export interface MessageBlockProps {
  message: Message;
  isFirst: boolean;
  worktreePath?: string;
  searchQuery?: string;
  currentMatchIndex?: number;
  matchOffset?: number;
  hasMatches?: boolean;
}

export const MessageBlock = memo(function MessageBlock({
  message,
  isFirst,
  worktreePath,
  searchQuery = '',
  currentMatchIndex = 0,
  matchOffset = 0,
  // hasMatches is intentionally not destructured — it's only used by the memo
  // comparator below to skip re-renders for messages without search matches.
}: MessageBlockProps) {
  const [copied, setCopied] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const copyContent = useCallback(async () => {
    const success = await copyToClipboard(message.content);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), COPY_FEEDBACK_DURATION_MS);
    }
  }, [message.content]);

  // Highlighted content for plain text messages
  const highlightedContent = useMemo(() => {
    if (!searchQuery) return null;
    return highlightSearchMatches(message.content, searchQuery, currentMatchIndex, matchOffset);
  }, [message.content, searchQuery, currentMatchIndex, matchOffset]);

  // System messages (setup info, etc.)
  if (message.role === 'system') {
    if (message.setupInfo) {
      return (
        <div className={cn('py-3', !isFirst && 'pt-4')}>
          <SystemInfoCard setupInfo={message.setupInfo} />
        </div>
      );
    }
    // Fallback for system messages without setup info
    return (
      <div className={cn('py-2', !isFirst && 'pt-3')}>
        <div className="text-base text-muted-foreground">
          {highlightedContent || message.content}
        </div>
      </div>
    );
  }

  if (message.role === 'user') {
    return (
      <div className={cn('py-2 flex justify-end', !isFirst && 'pt-3')}>
        <div className="max-w-[85%]">
          <div className="bg-surface-2 dark:bg-[#2D1B4E] rounded-lg px-4 py-2.5">
            {message.attachments && message.attachments.length > 0 && (
              <>
                <AttachmentGrid
                  attachments={message.attachments}
                  onPreview={(index) => setPreviewIndex(index)}
                  readOnly
                />
                {previewIndex !== null && (
                  <AttachmentPreviewModal
                    open
                    onOpenChange={(open) => { if (!open) setPreviewIndex(null); }}
                    attachments={message.attachments}
                    initialIndex={previewIndex}
                    fromHistory
                  />
                )}
              </>
            )}
            <p className="text-base leading-relaxed whitespace-pre-wrap">
              {highlightedContent || <MentionText content={message.content} />}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Context menu items shared between timeline and legacy paths
  const assistantContextMenuItems = (
    <>
      <ContextMenuItem onClick={copyContent}>
        <Copy className="size-4" />
        Copy
      </ContextMenuItem>
      <ContextMenuItem onClick={copyContent}>
        <FileText className="size-4" />
        Copy as Markdown
      </ContextMenuItem>
    </>
  );

  return (
    <div className="py-2">
      <div className="space-y-1.5 group">
        {/* Backward compat: show planContent at top for old messages without plan timeline entry */}
        {message.planContent && !(message.timeline?.some(e => e.type === 'plan')) && (
          <ApprovedPlanBlock
            cacheKey={`plan:${message.id}`}
            content={message.planContent}
          />
        )}

        {/* Interleaved timeline rendering (preserves text/tool ordering from streaming) */}
        {message.timeline && message.timeline.length > 0 && message.toolUsage ? (
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div className="group relative">
                {message.timeline.map((entry, idx) => {
                  if (entry.type === 'thinking') {
                    return (
                      <ThinkingNode
                        key={`tl-thinking-${idx}`}
                        content={entry.content}
                      />
                    );
                  } else if (entry.type === 'text') {
                    return (
                      <div
                        key={`tl-text-${idx}`}
                        className={PROSE_CLASSES}
                      >
                        <CachedMarkdown
                          cacheKey={`msg:${message.id}:tl:${idx}`}
                          content={entry.content}
                        />
                      </div>
                    );
                  } else if (entry.type === 'tool') {
                    const tool = message.toolUsage!.find(t => t.id === entry.toolId);
                    if (!tool) return null;
                    return (
                      <ToolUsageBlock
                        key={`tl-tool-${entry.toolId}`}
                        id={tool.id}
                        tool={tool.tool}
                        params={tool.params}
                        isActive={false}
                        success={tool.success}
                        summary={tool.summary}
                        duration={tool.durationMs}
                        stdout={tool.stdout}
                        stderr={tool.stderr}
                        worktreePath={worktreePath}
                        metadata={tool.metadata}
                        conversationId={message.conversationId}
                        messageId={message.id}
                        compacted={message.compacted}
                      />
                    );
                  } else if (entry.type === 'plan') {
                    return (
                      <ApprovedPlanBlock
                        key={`tl-plan-${idx}`}
                        cacheKey={`plan:${message.id}:tl:${idx}`}
                        content={entry.content}
                      />
                    );
                  } else if (entry.type === 'status') {
                    return (
                      <TurnStatusIndicator
                        key={`tl-status-${idx}`}
                        content={entry.content}
                        variant={entry.variant}
                      />
                    );
                  }
                  return null;
                })}
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute top-0 right-0 h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={copyContent}
                >
                  {copied ? (
                    <Check className="h-2.5 w-2.5 text-text-success" />
                  ) : (
                    <Copy className="h-2.5 w-2.5" />
                  )}
                </Button>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              {assistantContextMenuItems}
            </ContextMenuContent>
          </ContextMenu>
        ) : (
          <>
            {/* Legacy fallback: Thinking content for messages without timeline */}
            {message.role === 'assistant' && message.thinkingContent && (
              <ThinkingNode content={message.thinkingContent} />
            )}

            {/* Legacy fallback: Tool Usage Summary (collapsed) + full content */}
            {message.toolUsage && message.toolUsage.length > 0 && (
              <ErrorBoundary
                section="ToolUsage"
                fallback={<InlineErrorFallback message="Unable to display tool usage" />}
              >
                <ToolUsageSummary tools={message.toolUsage} worktreePath={worktreePath} conversationId={message.conversationId} messageId={message.id} compacted={message.compacted} />
              </ErrorBoundary>
            )}

            {/* Main Content */}
            {message.content && (
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <div className="group relative">
                    <div className={PROSE_CLASSES}>
                      <ErrorBoundary
                        section="MessageContent"
                        fallback={
                          <div className="text-sm text-muted-foreground italic">
                            Unable to render message content
                          </div>
                        }
                      >
                        <CachedMarkdown
                          cacheKey={`msg:${message.id}`}
                          content={message.content}
                        />
                      </ErrorBoundary>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute top-0 right-0 h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={copyContent}
                    >
                      {copied ? (
                        <Check className="h-2.5 w-2.5 text-text-success" />
                      ) : (
                        <Copy className="h-2.5 w-2.5" />
                      )}
                    </Button>
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  {assistantContextMenuItems}
                </ContextMenuContent>
              </ContextMenu>
            )}
          </>
        )}

        {/* Verification Results */}
        {message.verificationResults && message.verificationResults.length > 0 && (
          <VerificationBlock results={message.verificationResults} />
        )}

        {/* File Changes */}
        {message.fileChanges && message.fileChanges.length > 0 && (
          <FileChangesBlock changes={message.fileChanges} worktreePath={worktreePath} />
        )}

        {/* Per-message token/cost footer */}
        {message.runSummary && (
          <MessageTokenFooter summary={message.runSummary} />
        )}

        {/* Run Summary */}
        {message.runSummary && (
          <RunSummaryBlock
            summary={message.runSummary}
            checkpointUuid={message.checkpointUuid}
            conversationId={message.conversationId}
          />
        )}
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  const prev = prevProps.message;
  const next = nextProps.message;

  // Core fields
  if (prev.id !== next.id ||
    prev.content !== next.content ||
    prev.timestamp !== next.timestamp ||
    prev.role !== next.role ||
    prev.thinkingContent !== next.thinkingContent ||
    prev.planContent !== next.planContent ||
    prev.checkpointUuid !== next.checkpointUuid ||
    prevProps.isFirst !== nextProps.isFirst ||
    prevProps.worktreePath !== nextProps.worktreePath ||
    prevProps.searchQuery !== nextProps.searchQuery) {
    return false;
  }

  // Structured fields — reference equality (updateMessage spreads new objects/arrays)
  if (prev.toolUsage !== next.toolUsage ||
    prev.timeline !== next.timeline ||
    prev.fileChanges !== next.fileChanges ||
    prev.verificationResults !== next.verificationResults ||
    prev.attachments !== next.attachments ||
    prev.runSummary !== next.runSummary ||
    prev.setupInfo !== next.setupInfo) {
    return false;
  }

  // Search navigation — only compare when relevant
  if (nextProps.hasMatches || prevProps.hasMatches) {
    if (prevProps.currentMatchIndex !== nextProps.currentMatchIndex ||
      prevProps.matchOffset !== nextProps.matchOffset) {
      return false;
    }
  }

  return true;
});
