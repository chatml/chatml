/**
 * CommentZoneManager - Manages Monaco view zones for inline review comments
 *
 * View zones are DOM elements inserted between lines in the editor.
 * This manager handles:
 * - Creating view zones for comments
 * - Rendering React components into zone DOM nodes
 * - Tracking zones for updates and cleanup
 * - Dynamic height adjustment via ResizeObserver
 */

import type { editor, Range as MonacoRange } from 'monaco-editor';
import type { Root } from 'react-dom/client';
import { createRoot } from 'react-dom/client';
import type { ReviewComment } from '@/lib/types';

// Import monaco Range class for decorations
// This is done via dynamic import in the constructor to avoid SSR issues
let MonacoRangeClass: typeof MonacoRange | null = null;

export interface CommentZoneConfig {
  onResolve: (id: string, resolved: boolean) => void;
  onDelete?: (id: string) => void;
}

interface ZoneEntry {
  zoneId: string;
  comment: ReviewComment;
  container: HTMLDivElement;
  root: Root;
}

/**
 * Manages Monaco view zones for displaying inline comments.
 *
 * Usage:
 * 1. Create instance with editor reference and config
 * 2. Call setComments() with array of comments
 * 3. Call dispose() when editor unmounts
 */
export class CommentZoneManager {
  private editor: editor.IStandaloneCodeEditor;
  private config: CommentZoneConfig;
  private zones: Map<string, ZoneEntry> = new Map();
  private observers: Map<string, ResizeObserver> = new Map();
  private decorationIds: string[] = [];
  private renderCallback: ((comment: ReviewComment, container: HTMLDivElement, root: Root) => void) | null = null;

  constructor(
    editor: editor.IStandaloneCodeEditor,
    config: CommentZoneConfig
  ) {
    this.editor = editor;
    this.config = config;
  }

  /**
   * Set the render callback for creating React components in view zones.
   * This should be called before setComments().
   */
  setRenderCallback(
    callback: (comment: ReviewComment, container: HTMLDivElement, root: Root) => void
  ): void {
    this.renderCallback = callback;
  }

  /**
   * Update all comments, adding new ones and removing deleted ones.
   * This is the main API - call this whenever comments change.
   */
  setComments(comments: ReviewComment[]): void {
    if (!this.renderCallback) {
      console.warn('CommentZoneManager: No render callback set');
      return;
    }

    const currentIds = new Set(this.zones.keys());
    const newIds = new Set(comments.map((c) => c.id));

    // Remove zones for deleted comments
    for (const id of currentIds) {
      if (!newIds.has(id)) {
        this.removeZone(id);
      }
    }

    // Add or update zones for current comments
    for (const comment of comments) {
      if (currentIds.has(comment.id)) {
        // Update existing zone
        this.updateZone(comment);
      } else {
        // Add new zone
        this.addZone(comment);
      }
    }

    this.updateDecorations(comments);
  }

  /**
   * Add a view zone for a single comment.
   */
  private addZone(comment: ReviewComment): void {
    if (!this.renderCallback) return;

    // Create container DOM node
    const container = document.createElement('div');
    container.className = 'comment-zone-container';
    container.style.padding = '4px 0';

    // Create React root synchronously (imported at module level)
    const root = createRoot(container);
    this.renderCallback(comment, container, root);

    // Set up ResizeObserver for dynamic height
    const observer = new ResizeObserver(() => {
      this.layoutZone(comment.id);
    });
    observer.observe(container);
    this.observers.set(comment.id, observer);

    // Add view zone to editor
    this.editor.changeViewZones((accessor) => {
      const zoneId = accessor.addZone({
        afterLineNumber: comment.lineNumber,
        heightInPx: 80, // Initial height, will be adjusted by ResizeObserver
        domNode: container,
        suppressMouseDown: false, // Allow click interactions
      });

      this.zones.set(comment.id, {
        zoneId,
        comment,
        container,
        root,
      });
    });
  }

  /**
   * Update an existing zone's content.
   */
  private updateZone(comment: ReviewComment): void {
    const zone = this.zones.get(comment.id);
    if (!zone || !this.renderCallback) return;

    // Update the stored comment reference
    zone.comment = comment;

    // Re-render the React component with updated comment
    this.renderCallback(comment, zone.container, zone.root);
  }

  /**
   * Remove a view zone.
   */
  private removeZone(commentId: string): void {
    const zone = this.zones.get(commentId);
    if (!zone) return;

    // Remove from editor
    this.editor.changeViewZones((accessor) => {
      accessor.removeZone(zone.zoneId);
    });

    // Cleanup React root
    zone.root.unmount();

    // Cleanup ResizeObserver
    const observer = this.observers.get(commentId);
    if (observer) {
      observer.disconnect();
      this.observers.delete(commentId);
    }

    this.zones.delete(commentId);
  }

  /**
   * Trigger layout recalculation for a zone (called by ResizeObserver).
   */
  private layoutZone(commentId: string): void {
    const zone = this.zones.get(commentId);
    if (!zone) return;

    this.editor.changeViewZones((accessor) => {
      accessor.layoutZone(zone.zoneId);
    });
  }

  /**
   * Update gutter decorations for comment lines.
   */
  private updateDecorations(comments: ReviewComment[]): void {
    // Load Range class if not already loaded
    if (!MonacoRangeClass) {
      import('monaco-editor').then((monaco) => {
        MonacoRangeClass = monaco.Range;
        this.applyDecorations(comments);
      });
    } else {
      this.applyDecorations(comments);
    }
  }

  /**
   * Apply decorations using the cached Range class.
   */
  private applyDecorations(comments: ReviewComment[]): void {
    if (!MonacoRangeClass) return;

    const decorations = comments.map((comment) => ({
      range: new MonacoRangeClass!(comment.lineNumber, 1, comment.lineNumber, 1),
      options: {
        isWholeLine: true,
        glyphMarginClassName: this.getGlyphClass(comment),
        glyphMarginHoverMessage: { value: `**${comment.author}**: ${comment.content.substring(0, 100)}...` },
      },
    }));

    this.decorationIds = this.editor.deltaDecorations(this.decorationIds, decorations);
  }

  /**
   * Get the CSS class for the gutter glyph based on comment state.
   */
  private getGlyphClass(comment: ReviewComment): string {
    if (comment.resolved) {
      return 'comment-gutter-resolved';
    }
    switch (comment.severity) {
      case 'error':
        return 'comment-gutter-error';
      case 'warning':
        return 'comment-gutter-warning';
      case 'suggestion':
        return 'comment-gutter-suggestion';
      default:
        return 'comment-gutter-default';
    }
  }

  // --- Comment input view zone ---
  private inputZoneId: string | null = null;
  private inputContainer: HTMLDivElement | null = null;
  private inputRoot: Root | null = null;
  private inputObserver: ResizeObserver | null = null;

  /**
   * Show an inline comment input at the given line number.
   * Only one input can be active at a time.
   */
  showCommentInput(
    lineNumber: number,
    renderCallback: (container: HTMLDivElement, root: Root) => void
  ): void {
    // Remove any existing input first
    this.hideCommentInput();

    const container = document.createElement('div');
    container.className = 'comment-zone-container comment-input-zone';
    container.style.padding = '4px 0';

    const root = createRoot(container);
    renderCallback(container, root);

    const observer = new ResizeObserver(() => {
      if (this.inputZoneId) {
        this.editor.changeViewZones((accessor) => {
          accessor.layoutZone(this.inputZoneId!);
        });
      }
    });
    observer.observe(container);

    this.editor.changeViewZones((accessor) => {
      this.inputZoneId = accessor.addZone({
        afterLineNumber: lineNumber,
        heightInPx: 120,
        domNode: container,
        suppressMouseDown: false,
      });
    });

    this.inputContainer = container;
    this.inputRoot = root;
    this.inputObserver = observer;
  }

  /**
   * Hide and clean up the comment input view zone.
   */
  hideCommentInput(): void {
    if (this.inputZoneId) {
      this.editor.changeViewZones((accessor) => {
        accessor.removeZone(this.inputZoneId!);
      });
      this.inputZoneId = null;
    }
    if (this.inputRoot) {
      this.inputRoot.unmount();
      this.inputRoot = null;
    }
    if (this.inputObserver) {
      this.inputObserver.disconnect();
      this.inputObserver = null;
    }
    this.inputContainer = null;
  }

  /**
   * Dispose all resources. Call when editor unmounts.
   */
  dispose(): void {
    // Remove comment input if active
    this.hideCommentInput();
    // Remove all zones
    this.editor.changeViewZones((accessor) => {
      for (const zone of this.zones.values()) {
        accessor.removeZone(zone.zoneId);
      }
    });

    // Cleanup React roots
    for (const zone of this.zones.values()) {
      zone.root.unmount();
    }

    // Cleanup observers
    for (const observer of this.observers.values()) {
      observer.disconnect();
    }

    // Clear decorations
    this.decorationIds = this.editor.deltaDecorations(this.decorationIds, []);

    // Clear all maps
    this.zones.clear();
    this.observers.clear();
  }

  /**
   * Get config for external components to call actions.
   */
  getConfig(): CommentZoneConfig {
    return this.config;
  }
}
