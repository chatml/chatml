import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 text-center">
      <h1 className="mb-4 text-4xl font-bold">ChatML Documentation</h1>
      <p className="mb-8 max-w-lg text-lg text-fd-muted-foreground">
        Learn how to use ChatML — the AI-native IDE that gives Claude direct
        access to your codebase through isolated git worktrees.
      </p>
      <div className="flex gap-4">
        <Link
          href="/docs"
          className="rounded-lg bg-fd-primary px-6 py-3 font-medium text-fd-primary-foreground transition-colors hover:bg-fd-primary/90"
        >
          Get Started
        </Link>
        <Link
          href="/docs/getting-started/installation"
          className="rounded-lg border border-fd-border px-6 py-3 font-medium transition-colors hover:bg-fd-accent"
        >
          Installation
        </Link>
      </div>
    </main>
  );
}
