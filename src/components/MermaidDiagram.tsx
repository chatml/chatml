'use client';

import { useState, useEffect, useId } from 'react';
import mermaid from 'mermaid';
import { TransformWrapper, TransformComponent, useControls } from 'react-zoom-pan-pinch';
import { Button } from '@/components/ui/button';
import { ZoomIn, ZoomOut, Undo2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ErrorBoundary } from '@/components/ErrorBoundary';

interface MermaidDiagramProps {
  code: string;
}

function ZoomControls() {
  const { zoomIn, zoomOut, resetTransform } = useControls();

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={() => zoomIn()}
        title="Zoom in"
      >
        <ZoomIn className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={() => zoomOut()}
        title="Zoom out"
      >
        <ZoomOut className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={() => resetTransform()}
        title="Reset zoom"
      >
        <Undo2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

export function MermaidDiagram({ code }: MermaidDiagramProps) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const uniqueId = useId().replace(/:/g, '-');

  useEffect(() => {
    let cancelled = false;

    const renderDiagram = async () => {
      setIsLoading(true);
      setError(null);

      try {
        // Detect dark mode
        const isDark = document.documentElement.classList.contains('dark') ||
          window.matchMedia('(prefers-color-scheme: dark)').matches;

        // Initialize mermaid with theme
        mermaid.initialize({
          startOnLoad: false,
          theme: isDark ? 'dark' : 'default',
          securityLevel: 'loose',
          fontFamily: 'inherit',
          flowchart: {
            padding: 8,
            nodeSpacing: 30,
            rankSpacing: 30,
          },
          sequence: {
            diagramMarginX: 8,
            diagramMarginY: 8,
          },
          gantt: {
            leftPadding: 50,
          },
        });

        // Render the diagram
        const { svg: renderedSvg } = await mermaid.render(`mermaid-${uniqueId}`, code);

        if (!cancelled) {
          setSvg(renderedSvg);
          setIsLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to render diagram');
          setIsLoading(false);
        }
      }
    };

    renderDiagram();

    return () => {
      cancelled = true;
    };
  }, [code, uniqueId]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8 rounded-lg border border-border/50 bg-muted/30">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          Rendering diagram...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-destructive/20">
          <AlertCircle className="w-4 h-4 text-destructive" />
          <span className="text-xs font-medium text-destructive">Mermaid Error</span>
        </div>
        <div className="p-3">
          <p className="text-xs text-destructive/80 mb-2">{error}</p>
          <pre className="text-xs bg-muted/50 p-2 rounded overflow-x-auto">
            <code>{code}</code>
          </pre>
        </div>
      </div>
    );
  }

  // ErrorBoundary catches unexpected render errors (e.g., in TransformWrapper/zoom controls)
  // while the error state above handles Mermaid parsing/syntax errors
  return (
    <ErrorBoundary
      section="MermaidDiagram"
      fallback={
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 my-4">
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="w-4 h-4" />
            <span>Failed to render diagram</span>
          </div>
        </div>
      }
    >
      <div className="rounded-lg border border-border/50 bg-muted/30 overflow-hidden my-4">
        <TransformWrapper
          initialScale={1}
          minScale={0.5}
          maxScale={3}
          centerOnInit
          wheel={{ disabled: true }}
        >
          {/* Header with controls */}
          <div className="flex items-center px-2 py-1.5 border-b border-border/50 bg-muted/50">
            <ZoomControls />
            <div className="flex-1" />
            <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
              Mermaid
            </span>
          </div>

          {/* Diagram area */}
          <TransformComponent
            wrapperClass="!w-full"
            contentClass="!w-full flex items-center justify-center"
          >
            <div
              className={cn(
                'p-2 min-h-[100px] flex items-center justify-center',
                '[&_svg]:max-w-full [&_svg]:h-auto'
              )}
              dangerouslySetInnerHTML={{ __html: svg || '' }}
            />
          </TransformComponent>
        </TransformWrapper>
      </div>
    </ErrorBoundary>
  );
}
