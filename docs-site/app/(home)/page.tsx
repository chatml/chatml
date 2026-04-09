import Link from 'next/link';
import Image from 'next/image';

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col">
      {/* Hero */}
      <section className="flex flex-col items-center justify-center gap-6 px-6 py-24 text-center">
        <Image
          src="/mascot.png"
          alt="ChatML"
          width={80}
          height={80}
          priority
          className="rounded-full ring-4 ring-primary/30"
        />
        <h1 className="max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">
          The AI-native IDE for{' '}
          <span className="text-primary">macOS</span>
        </h1>
        <p className="max-w-2xl text-lg text-muted-foreground">
          Give Claude direct access to your codebase through isolated git
          worktrees. Run multiple AI-driven tasks in parallel, review code,
          create PRs, and ship faster.
        </p>
        <div className="flex gap-3">
          <Link
            href="https://github.com/chatml/chatml/releases"
            className="inline-flex h-10 items-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
          >
            Download
          </Link>
          <Link
            href="/docs"
            className="inline-flex h-10 items-center rounded-md border border-input bg-background px-6 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            Read the Docs
          </Link>
        </div>
      </section>

      {/* Features Grid */}
      <section className="mx-auto grid max-w-5xl gap-8 px-6 py-16 sm:grid-cols-3">
        <FeatureCard
          title="Isolated Sessions"
          description="Each task gets its own git worktree and branch. Run multiple AI agents in parallel without interference."
        />
        <FeatureCard
          title="Real-Time Streaming"
          description="Watch Claude work in real time — file reads, edits, command execution, and extended thinking as they happen."
        />
        <FeatureCard
          title="Built-In Code Review"
          description="Structured reviews with inline comments, severity levels, and resolution tracking. Create PRs directly from sessions."
        />
        <FeatureCard
          title="Mission Control"
          description="Dashboard with attention queue, live activity feed, and 14-day spend tracker across all sessions."
        />
        <FeatureCard
          title="19+ Skills"
          description="Specialized prompt templates for TDD, security audits, debugging, PR creation, and more."
        />
        <FeatureCard
          title="Deep Integrations"
          description="GitHub, Linear, Sentry, MCP servers, and Anthropic API — all connected natively."
        />
      </section>

      {/* How It Works */}
      <section className="border-t bg-muted/30 px-6 py-16">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="mb-12 text-2xl font-bold">How It Works</h2>
          <div className="grid gap-8 sm:grid-cols-3">
            <StepCard step="1" title="Add a Workspace" description="Point ChatML at any git repository on your machine." />
            <StepCard step="2" title="Create a Session" description="Get an isolated worktree and branch for your task." />
            <StepCard step="3" title="Work with Claude" description="Chat, review, and ship — Claude has full access to your code." />
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="flex flex-col items-center gap-4 px-6 py-16 text-center">
        <h2 className="text-2xl font-bold">Get started in minutes</h2>
        <p className="text-muted-foreground">
          Download ChatML, add your API key, and create your first session.
        </p>
        <Link
          href="/docs/getting-started/installation"
          className="inline-flex h-10 items-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
        >
          Installation Guide
        </Link>
      </section>
    </main>
  );
}

function FeatureCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-6 text-left shadow-sm">
      <h3 className="mb-2 font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function StepCard({
  step,
  title,
  description,
}: {
  step: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
        {step}
      </div>
      <h3 className="font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
