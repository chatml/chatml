'use client';

import type { AnchorHTMLAttributes } from 'react';
import { openUrlInBrowser } from '@/lib/tauri';

function getFragment(href: string): string | null {
  if (href.startsWith('#')) return href.slice(1);
  try {
    const url = new URL(href);
    return url.hash ? url.hash.slice(1) : null;
  } catch {
    return null;
  }
}

export function MarkdownLink({
  href,
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    if (!href) return;

    const fragment = getFragment(href);
    if (fragment) {
      const target = document.getElementById(fragment);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
    }

    openUrlInBrowser(href);
  };

  return (
    <a
      {...props}
      href={href}
      onClick={handleClick}
      className="text-brand underline underline-offset-2 hover:text-brand/80 cursor-pointer"
    >
      {children}
    </a>
  );
}
