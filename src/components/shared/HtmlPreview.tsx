'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Maximize2, Minimize2, AlertCircle, Eye, Code2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { useResolvedThemeType } from '@/hooks/useResolvedThemeType';
import { CodeBlockWithCopy } from '@/components/shared/CodeBlockWithCopy';

interface HtmlPreviewProps {
  code: string;
}

const RESIZE_MESSAGE_TYPE = 'chatml-iframe-resize';
const DEFAULT_HEIGHT = 150;
const MAX_INLINE_HEIGHT = 600;
const MIN_HEIGHT = 60;
const DEBOUNCE_MS = 200;

/**
 * Build a complete HTML document for the iframe srcdoc.
 * Injects theme styles and a ResizeObserver script for auto-height.
 */
function buildSrcdoc(code: string, theme: 'dark' | 'light'): string {
  const isDark = theme === 'dark';
  const bg = isDark ? '#1a1a1a' : '#ffffff';
  const fg = isDark ? '#e0e0e0' : '#1a1a1a';
  const colorScheme = isDark ? 'dark' : 'light';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; img-src data: blob:; font-src data:; object-src 'none'; base-uri 'none';">
<style>
*, *::before, *::after { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 8px;
  background: ${bg};
  color: ${fg};
  color-scheme: ${colorScheme};
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  overflow-x: hidden;
}
</style>
</head>
<body>
${code}
<script>
(function() {
  function report() {
    // srcdoc frames have an opaque origin; '*' is required and safe because
    // the parent validates event.source against the specific iframe reference.
    window.parent.postMessage({
      type: '${RESIZE_MESSAGE_TYPE}',
      height: document.documentElement.scrollHeight
    }, '*');
  }
  new ResizeObserver(report).observe(document.body);
  report();
})();
</script>
</body>
</html>`;
}

function PreviewIframe({
  srcdoc,
  height,
  maxHeight,
  onResize,
}: {
  srcdoc: string;
  height: number;
  maxHeight?: number;
  onResize: (height: number) => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (
        event.data?.type === RESIZE_MESSAGE_TYPE &&
        event.source === iframeRef.current?.contentWindow
      ) {
        onResize(event.data.height);
      }
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onResize]);

  const clampedHeight = Math.max(MIN_HEIGHT, Math.min(height, maxHeight ?? MAX_INLINE_HEIGHT));

  return (
    <iframe
      ref={iframeRef}
      srcDoc={srcdoc}
      sandbox="allow-scripts"
      style={{
        width: '100%',
        height: clampedHeight,
        border: 0,
        display: 'block',
        transition: 'height 150ms ease',
      }}
      title="HTML Preview"
    />
  );
}

export function HtmlPreview({ code }: HtmlPreviewProps) {
  const [activeTab, setActiveTab] = useState<string>('preview');
  const [iframeHeight, setIframeHeight] = useState(DEFAULT_HEIGHT);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const theme = useResolvedThemeType();

  // Debounce srcdoc updates during streaming
  const [debouncedCode, setDebouncedCode] = useState(code);
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      setDebouncedCode(code);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [code]);

  const srcdoc = useMemo(() => buildSrcdoc(debouncedCode, theme), [debouncedCode, theme]);

  const handleInlineResize = useCallback(
    (height: number) => setIframeHeight(height),
    []
  );

  return (
    <ErrorBoundary
      section="HtmlPreview"
      fallback={
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 my-4">
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="w-4 h-4" />
            <span>Failed to render HTML preview</span>
          </div>
        </div>
      }
    >
      <div className="rounded-lg border border-border/50 bg-muted/30 overflow-hidden my-4">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="gap-0">
          {/* Header */}
          <div className="flex items-center px-2 py-1.5 border-b border-border/50 bg-muted/50">
            <TabsList className="h-6">
              <TabsTrigger value="preview" className="h-5 text-2xs px-2 gap-1">
                <Eye className="h-3 w-3" />
                Preview
              </TabsTrigger>
              <TabsTrigger value="code" className="h-5 text-2xs px-2 gap-1">
                <Code2 className="h-3 w-3" />
                Code
              </TabsTrigger>
            </TabsList>
            <div className="flex-1" />
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 mr-1"
              onClick={() => setIsFullscreen(true)}
              title="Expand preview"
              aria-label="Expand preview fullscreen"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </Button>
            <span className="text-2xs text-muted-foreground font-medium uppercase tracking-wider">
              HTML
            </span>
          </div>

          {/* Preview tab */}
          <TabsContent value="preview" className="mt-0">
            <PreviewIframe
              srcdoc={srcdoc}
              height={iframeHeight}
              onResize={handleInlineResize}
            />
          </TabsContent>

          {/* Code tab */}
          <TabsContent value="code" className="mt-0">
            <CodeBlockWithCopy code={code}>
              <code className="language-html">{code}</code>
            </CodeBlockWithCopy>
          </TabsContent>
        </Tabs>
      </div>

      {/* Fullscreen dialog */}
      <Dialog open={isFullscreen} onOpenChange={setIsFullscreen}>
        <DialogContent
          className="sm:max-w-[95vw] h-[90vh] p-0 flex flex-col"
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">HTML Preview</DialogTitle>
          <DialogDescription className="sr-only">Fullscreen view of the HTML preview</DialogDescription>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 gap-0 min-h-0">
            <div className="flex items-center px-3 py-2 border-b border-border/50 bg-muted/50">
              <TabsList className="h-6">
                <TabsTrigger value="preview" className="h-5 text-2xs px-2 gap-1">
                  <Eye className="h-3 w-3" />
                  Preview
                </TabsTrigger>
                <TabsTrigger value="code" className="h-5 text-2xs px-2 gap-1">
                  <Code2 className="h-3 w-3" />
                  Code
                </TabsTrigger>
              </TabsList>
              <div className="flex-1" />
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => setIsFullscreen(false)}
                title="Close fullscreen"
                aria-label="Close fullscreen view"
              >
                <Minimize2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            <TabsContent value="preview" className="flex-1 mt-0 min-h-0">
              <iframe
                srcDoc={srcdoc}
                sandbox="allow-scripts"
                style={{ width: '100%', height: '100%', border: 0, display: 'block' }}
                title="HTML Preview"
              />
            </TabsContent>
            <TabsContent value="code" className="flex-1 mt-0 min-h-0 overflow-auto">
              <CodeBlockWithCopy code={code}>
                <code className="language-html">{code}</code>
              </CodeBlockWithCopy>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </ErrorBoundary>
  );
}
