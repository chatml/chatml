import Image from 'next/image';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import type { ReactNode } from 'react';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <HomeLayout
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
      links={[
        { text: 'Documentation', url: '/docs' },
        { text: "What's New", url: '/docs/changelog/whats-new' },
      ]}
      githubUrl="https://github.com/chatml/chatml"
    >
      {children}
    </HomeLayout>
  );
}
