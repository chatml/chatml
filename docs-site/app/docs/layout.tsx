import Image from 'next/image';
import { source } from '@/lib/source';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import type { ReactNode } from 'react';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={source.pageTree}
      nav={{
        title: (
          <span className="flex items-center gap-2">
            <Image
              src="/mascot.png"
              alt="ChatML"
              width={28}
              height={28}
              priority
              className="rounded-full ring-2 ring-primary/40"
            />
            <span className="font-mono text-lg font-bold tracking-[-0.05em]">
              <span className="text-foreground/60">chat</span>
              <span className="text-primary">ml</span>
            </span>
          </span>
        ),
      }}
      sidebar={{
        defaultOpenLevel: 1,
      }}
      links={[
        {
          text: 'Documentation',
          url: '/docs',
          active: 'nested-url',
        },
      ]}
      githubUrl="https://github.com/chatml/chatml"
    >
      {children}
    </DocsLayout>
  );
}
