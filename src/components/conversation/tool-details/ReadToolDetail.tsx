'use client';

import { CodeViewerDetail } from './CodeViewerDetail';

interface ReadToolDetailProps {
  content: string;
  filePath: string;
}

export const ReadToolDetail = function ReadToolDetail({ content, filePath }: ReadToolDetailProps) {
  return <CodeViewerDetail content={content} filePath={filePath} cachePrefix="tool-read" />;
};
