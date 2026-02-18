'use client';

import ReactMarkdown from 'react-markdown';
import { REMARK_PLUGINS, REHYPE_PLUGINS, MARKDOWN_COMPONENTS } from '@/lib/markdownConfig';
import { getCachedMarkdown, setCachedMarkdown } from '@/lib/markdownCache';

interface CachedMarkdownProps {
  cacheKey: string;
  content: string;
}

export function CachedMarkdown({ cacheKey, content }: CachedMarkdownProps) {
  const cached = getCachedMarkdown(cacheKey, content);
  if (cached !== undefined) {
    return <>{cached}</>;
  }

  const rendered = (
    <ReactMarkdown
      remarkPlugins={REMARK_PLUGINS}
      rehypePlugins={REHYPE_PLUGINS}
      components={MARKDOWN_COMPONENTS}
    >
      {content}
    </ReactMarkdown>
  );

  setCachedMarkdown(cacheKey, rendered, content);
  return rendered;
}
