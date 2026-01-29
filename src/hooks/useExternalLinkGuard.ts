'use client';

import { useEffect } from 'react';
import { openUrlInBrowser } from '@/lib/tauri';

/**
 * Global safety net: intercepts clicks on any <a> with an external href
 * and opens it in the system browser instead of navigating the Tauri webview.
 */
export function useExternalLinkGuard() {
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const anchor = (e.target as HTMLElement).closest('a');
      if (!anchor) return;

      const href = anchor.getAttribute('href');
      if (!href) return;

      // Only intercept external URLs (http/https)
      if (href.startsWith('http://') || href.startsWith('https://')) {
        e.preventDefault();
        e.stopPropagation();
        openUrlInBrowser(href);
      }
    }

    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, []);
}
