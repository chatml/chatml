'use client';

import Image from 'next/image';

export function WelcomeStep() {
  return (
    <div className="flex flex-col items-center text-center max-w-md mx-auto animate-scale-in">
      {/* Mascot */}
      <div className="mb-8">
        <div className="w-28 h-28 rounded-full ring-[3px] ring-primary/50 ring-offset-4 ring-offset-[#090909] overflow-hidden shadow-2xl shadow-primary/20">
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
        <span className="text-white/60">chat</span>
        <span className="text-primary">ml</span>
      </h1>

      {/* Tagline */}
      <p className="text-lg text-white/90 font-medium leading-relaxed">
        ChatML lets you run multiple AI coding agents in parallel, each in its own isolated workspace.
      </p>
      <p className="text-sm text-white/50 mt-3">
        Let&apos;s walk you through the key concepts.
      </p>
    </div>
  );
}
