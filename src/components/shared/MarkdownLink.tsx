'use client';

import type { AnchorHTMLAttributes } from 'react';
import { openUrlInBrowser } from '@/lib/tauri';

export function MarkdownLink({
  href,
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    if (href) {
      openUrlInBrowser(href);
    }
  };

  return (
    <a
      {...props}
      href={href}
      onClick={handleClick}
      className="text-primary underline underline-offset-2 hover:text-primary/80 cursor-pointer"
    >
      {children}
    </a>
  );
}
