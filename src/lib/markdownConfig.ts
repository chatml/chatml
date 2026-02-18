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
