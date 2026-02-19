import remarkGfm from 'remark-gfm';
import rehypeSlug from 'rehype-slug';
import rehypeHighlight from 'rehype-highlight';
import { rehypeEmoji } from '@/lib/rehypeEmoji';
import { MarkdownPre, MarkdownCode } from '@/components/shared/MarkdownCodeBlock';
import { MarkdownLink } from '@/components/shared/MarkdownLink';

// Hoisted to module scope to avoid creating new references on every render,
// which would cause ReactMarkdown to re-parse content unnecessarily.
export const REMARK_PLUGINS = [remarkGfm];
export const REHYPE_PLUGINS = [rehypeSlug, rehypeHighlight, rehypeEmoji];
export const MARKDOWN_COMPONENTS = { pre: MarkdownPre, code: MarkdownCode, a: MarkdownLink };

// Warm up rehype-highlight's internal highlight.js grammars during idle time.
// Without this, the first markdown render with code blocks pays a ~200-500ms
// cold-start penalty while highlight.js initializes language definitions.
if (typeof window !== 'undefined') {
  const warmUp = () => {
    import('highlight.js').then((hljs) => {
      try {
        hljs.default.highlightAuto('const x = 1;');
      } catch { /* ignore */ }
    }).catch(() => { /* ignore */ });
  };
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(warmUp, { timeout: 8000 });
  } else {
    setTimeout(warmUp, 3000);
  }
}
