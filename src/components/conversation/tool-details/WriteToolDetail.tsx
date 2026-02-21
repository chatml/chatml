'use client';

import { CodeViewerDetail } from './CodeViewerDetail';

interface WriteToolDetailProps {
  content: string;
  filePath: string;
}

export const WriteToolDetail = function WriteToolDetail({ content, filePath }: WriteToolDetailProps) {
  return <CodeViewerDetail content={content} filePath={filePath} cachePrefix="tool-write" />;
};
