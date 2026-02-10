'use client';

import Image from 'next/image';

export function WelcomeStep() {
  return (
    <div className="flex flex-col items-center text-center max-w-md mx-auto">
      {/* Mascot */}
      <div className="mb-8">
        <div className="w-28 h-28 rounded-full ring-[3px] ring-primary/50 ring-offset-4 ring-offset-background overflow-hidden shadow-2xl shadow-primary/20">
          <Image
            src="/mascot.png"
            alt="ChatML mascot"
            width={112}
            height={112}
            className="w-full h-full object-cover"
            priority
          />
        </div>
      </div>

      {/* Brand */}
      <h1 className="font-mono font-bold text-3xl tracking-[-0.05em] mb-6">
        <span className="text-foreground/60">chat</span>
        <span className="text-primary">ml</span>
      </h1>

      {/* Tagline */}
      <p className="text-xl text-foreground/90 font-medium leading-relaxed">
        Run multiple AI coding agents in parallel, each in its own isolated workspace.
      </p>
      <p className="text-base text-muted-foreground mt-3">
        Let&apos;s walk you through the key concepts.
      </p>
    </div>
  );
}
