# Plan: Open-Source Launch & Announcement Strategy

**Goal**: Maximize visibility, community adoption, and contributor engagement for ChatML's open-source release.

**Timeline**: 10 weeks total (4 weeks prep, 1 week launch, 5 weeks momentum).
**6-month targets**: 5,000+ GitHub stars, 50+ contributors, 2,000+ MAU.

---

## What We Learned From Comparable Launches

| Project | Launch Channel | Key Tactic | Outcome |
|---------|---------------|------------|---------|
| **Zed** | HN + Blog + GitHub | Open-sourced existing popular product with GPL license; community already knew the brand | 53K+ stars |
| **Cline** | VS Code marketplace + Word of mouth | Free extension in marketplace; low friction onboarding | 4M+ users |
| **Aider** | HN Show + r/LocalLLaMA | Model-agnostic positioning; great leaderboard page | 30K+ stars |
| **OpenHands** | Academic paper + GitHub + HN | SWE-bench leaderboard results as proof point | 48K+ stars |
| **Continue.dev** | HN + Product Hunt + VS Code | Open-core (Apache 2.0); pivoted messaging when market shifted | 31K+ stars |
| **Cursor** | Private beta + HN + Twitter | Waitlist → invite codes; scarcity drove demand (closed source) | $29.3B valuation |

**Pattern**: Every successful open-source dev tool launch included (1) a compelling demo/GIF, (2) a Hacker News post, and (3) strong README with immediate value proposition.

---

## Phase 1: Pre-Launch Preparation (Weeks 1-4)

### Week 1: Repository Readiness

- [ ] **License**: Add Apache 2.0 LICENSE file to repository root
- [ ] **README overhaul**: Rewrite for open-source audience (see template below)
- [ ] **CONTRIBUTING.md**: Already written (see `CONTRIBUTING.md`)
- [ ] **CODE_OF_CONDUCT.md**: Add Contributor Covenant
- [ ] **SECURITY.md**: Add responsible disclosure policy
- [ ] **Issue templates**: Bug report, feature request, skill contribution
- [ ] **PR template**: Checklist with lint/test/build verification
- [ ] **GitHub Topics**: Add `ai-coding`, `developer-tools`, `git-worktree`, `claude`, `tauri`, `desktop-app`, `open-source`, `code-review`, `mcp`
- [ ] **Remove secrets**: Audit for hardcoded API keys, internal URLs, private references
- [ ] **CI badge**: Add build status badge to README

### Week 2: Demo Assets

- [ ] **Hero GIF** (30-45 seconds): Record a screencast showing:
  1. Opening ChatML
  2. Creating a session (watch the worktree spawn)
  3. Asking the AI to implement a feature
  4. Seeing streaming response with tool execution
  5. Reviewing changes in the diff panel
  6. Creating a PR — all without leaving the app
  - Tools: CleanShot X, Kap, or `ffmpeg` for GIF. Keep under 5MB for GitHub.

- [ ] **Architecture diagram**: Clean SVG of the 4-layer architecture (Tauri → Next.js → Go → Node.js → Claude API). Put in README.

- [ ] **Comparison table**: ChatML vs Cursor vs Claude Code vs Cline vs Aider — honest feature matrix showing where ChatML wins (open source, privacy, desktop-native, full lifecycle).

- [ ] **30-second video**: Same as GIF but with voiceover. Upload to YouTube unlisted (embed in blog post).

### Week 3: Content Preparation

- [ ] **Blog post** (1,500-2,000 words): "Why We're Open-Sourcing ChatML"
  - The problem: AI coding tools are fragmented, cloud-dependent, and locked to single models
  - Our approach: Git worktree isolation, full lifecycle coverage, privacy-first
  - Architecture deep-dive (the 4-language stack and why)
  - What we're open-sourcing and what's coming next
  - Call to action: star, contribute, or just try it
  - Publish on: company blog, Dev.to, Hashnode (cross-post)

- [ ] **Twitter/X thread** (8-10 tweets): Pre-write for launch day
  - Tweet 1: Announcement + hero GIF
  - Tweet 2: The problem we solve
  - Tweet 3: Architecture diagram
  - Tweet 4: Demo video link
  - Tweet 5: Why open source
  - Tweet 6: Feature highlights (worktrees, streaming, review)
  - Tweet 7: What you can contribute
  - Tweet 8: Star the repo + link

- [ ] **HN "Show HN" post**: Pre-draft title and description
  - **Title**: `Show HN: ChatML – Open-source desktop app for parallel AI coding with git worktrees`
  - Keep under 80 characters. No superlatives. Focus on the unique angle (worktrees + parallel).
  - First comment: Prepared 200-word description of what it is, why you built it, what's unique, and what help you need.

- [ ] **Reddit posts**: Pre-draft for:
  - r/programming — technical angle (architecture, polyglot stack)
  - r/LocalLLaMA — model-agnostic future, local model support roadmap
  - r/macapps — native macOS experience, Tauri vs Electron
  - r/opensource — the open-source journey and decisions

### Week 4: Community Infrastructure + Seeded Issues

- [ ] **Discord server**: Create with channels:
  - `#general` — introductions, discussion
  - `#help` — setup issues, questions
  - `#contributing` — PR discussion, architecture questions
  - `#showcase` — community demos
  - `#feature-requests` — ideas and voting
  - `#frontend`, `#backend`, `#agent-runner`, `#tauri` — layer-specific channels

- [ ] **GitHub Discussions**: Enable with categories:
  - Q&A, Ideas, Show and Tell, General

- [ ] **Seed 15-20 "Good First Issues"**: Pre-create issues that new contributors can pick up on day one:

  **Easy (documentation/config)**:
  1. Add dark mode screenshot to README
  2. Document all keyboard shortcuts
  3. Add `--help` flag output to agent-runner
  4. Write example MCP server configuration
  5. Add GitHub Actions badge to README

  **Easy (code)**:
  6. Add tooltip to session status icons
  7. Improve error message when backend port is occupied
  8. Add "Copy to clipboard" button for code blocks in chat
  9. Add confirmation dialog before archiving a session
  10. Show file size in file tab tooltip

  **Medium (single-layer)**:
  11. Add word count to conversation messages
  12. Implement "Collapse all tool outputs" toggle
  13. Add search/filter to session list sidebar
  14. Support custom constellation name pools (user config)
  15. Add export conversation as Markdown

  **Medium (skills contribution)**:
  16. Create "Docker Compose" skill
  17. Create "Database Migration" skill
  18. Create "CI/CD Pipeline" skill
  19. Create "React Component" skill
  20. Create "REST API Design" skill

- [ ] **Public roadmap**: Create GitHub Project board with columns:
  - Planned, In Progress, Done, Community Wishlist
  - Populate with key milestones: model abstraction, page.tsx refactor, appStore refactor, Windows/Linux polish, web version

- [ ] **Contributor pre-seeding**: Reach out to 5-10 developers who might be interested:
  - Tauri community members (Rust + desktop)
  - Claude Agent SDK early adopters
  - Go developers interested in AI tooling
  - Give them early access, ask for initial feedback + first PR

---

## Phase 2: Launch Day (Week 5)

### Timing

**Best day**: Tuesday or Wednesday (highest HN engagement for dev tools)
**Best time**: 8:00 AM Eastern / 12:00 UTC (catches US morning + EU afternoon)
**Avoid**: Fridays, weekends, major tech conference days, Apple/Google event days

### Launch Day Sequence

```
T-1 hour:  Final check — repo public, README renders, CI green, all links work
T+0:       Post "Show HN" on Hacker News
T+2 min:   Post first comment with 200-word description
T+5 min:   Publish Twitter/X thread
T+10 min:  Publish blog post (Dev.to + company blog)
T+30 min:  Post to r/programming
T+1 hour:  Post to r/LocalLLaMA (model-agnostic angle)
T+2 hours: Post to r/macapps (if significant HN traction)
T+3 hours: Share in relevant Discord communities (don't spam)
T+4 hours: Post to r/opensource
```

### HN Engagement Rules

1. **Respond to every comment** in the first 4 hours. This is the #1 factor in staying on the front page.
2. **Be genuine and humble**. Acknowledge limitations openly ("we're Claude-only today, model abstraction is our top priority").
3. **Don't be defensive** about the polyglot stack. Explain the reasoning when asked.
4. **Have talking points ready** for predictable questions:
   - "Why not just use Claude Code directly?" → Full lifecycle coverage, visual UI, parallel sessions, code review
   - "Why not a VS Code extension?" → Desktop-native performance, true process isolation, not limited by extension API
   - "Why four languages?" → Best tool for each job (Go for backend concurrency, Rust for native, React for UI, Node for SDK)
   - "How is this different from Cursor?" → Open source, privacy-first, no cloud dependency, model-agnostic roadmap
   - "Will you support OpenAI/Gemini/local models?" → Yes, model abstraction is our next milestone (link to plan)

### What to Monitor

- HN rank and comment count (refresh every 15 min for first 4 hours)
- GitHub star rate (should see 200-500+ on day 1 if HN front page)
- Issues opened (respond quickly to signal active maintenance)
- Discord joins
- Twitter engagement (retweet count, replies)

---

## Phase 3: Post-Launch Momentum (Weeks 6-10)

### Week 6: First Wave Response

- [ ] Respond to all GitHub issues opened during launch (within 24 hours)
- [ ] Merge first community PR (prioritize even small ones — the first merge is symbolic)
- [ ] Write "Week 1" update blog post: star count, contributor count, top feedback, what's next
- [ ] Thank early contributors publicly (Twitter mention + Discord shoutout)

### Week 7-8: Content Cadence

- [ ] **Technical deep-dive blog post #1**: "How ChatML Uses Git Worktrees for Parallel AI Sessions"
  - Publish on Dev.to + Hashnode
  - This is the evergreen SEO content that brings long-term discovery

- [ ] **Technical deep-dive blog post #2**: "Building a Polyglot Desktop App: Go + React + Rust + Node.js"
  - Targets Tauri, Go, and React communities separately

- [ ] **YouTube video**: 5-10 minute walkthrough demo
  - "I built an open-source AI coding IDE — here's how it works"
  - Target channels: Fireship-style quick overview or Theo-style reaction

- [ ] **Product Hunt launch**: Time this for week 7-8, NOT launch day
  - HN and Product Hunt audiences overlap but peak at different times
  - Use HN traction as social proof for Product Hunt

### Week 8-10: Community Building

- [ ] **First community call** (Discord voice / YouTube live): Walkthrough, Q&A, roadmap discussion
- [ ] **"Contributor of the Month"** recognition in Discord + README
- [ ] **Skills showcase**: Highlight community-contributed skills in a blog post
- [ ] **Hacktoberfest prep** (if timing aligns): Label issues for Hacktoberfest
- [ ] **Conference talks**: Submit CFPs for relevant conferences (All Things Open, React Conf, GopherCon, RustConf)

---

## README Template (Open-Source Version)

```markdown
# ChatML

**Open-source desktop IDE for AI-assisted development with parallel sessions.**

[Hero GIF here — 30 seconds showing the full workflow]

ChatML uses **git worktrees** to isolate each AI coding session into its own
branch and directory. Run multiple AI agents in parallel on the same repo
without conflicts. Review changes, create PRs, and monitor CI — all in one app.

## Why ChatML?

| | ChatML | Cursor | Claude Code | Cline |
|---|--------|--------|-------------|-------|
| Open source | Yes (Apache 2.0) | No | No | Yes |
| Desktop native | Yes (Tauri) | Yes (Electron) | Terminal | VS Code ext |
| Parallel sessions | Git worktrees | Background agents | --worktree flag | No |
| Code review | Built-in | Via Graphite | No | No |
| PR creation + CI | Built-in | No | Manual | No |
| Privacy | 100% local | Cloud features | Cloud API | Cloud API |

## Quick Start

[3-step install instructions]

## Architecture

[Clean SVG diagram]

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions.
We especially need help with: [top 3 areas]

## License

Apache License 2.0
```

---

## Positioning Matrix

Tailor the message per audience:

| Audience | Channel | Angle | Key Message |
|----------|---------|-------|-------------|
| **General developers** | HN, r/programming | Productivity | "Parallel AI sessions that don't step on each other's toes" |
| **AI/ML engineers** | r/LocalLLaMA, AI Discord | Model freedom | "Model-agnostic roadmap — Claude today, any model tomorrow" |
| **macOS enthusiasts** | r/macapps, Mac-focused blogs | Native quality | "Tauri-native, not Electron. 5x less memory than VS Code extensions" |
| **Open-source advocates** | r/opensource, FOSS communities | Philosophy | "Your AI coding tool shouldn't be a black box" |
| **Go developers** | GopherSlack, r/golang | Architecture | "Go backend with chi + SQLite + WebSocket — clean and fast" |
| **Rust developers** | r/rust, Rust Discord | Tauri | "Tauri 2 desktop app with native macOS integration" |
| **React developers** | r/reactjs, React Discord | Frontend | "230+ components, Zustand 5, React 19, Next.js 16" |
| **Privacy-conscious devs** | Privacy forums, HN | Trust | "SQLite on your machine. No telemetry. Audit the code." |

---

## Metrics & Milestones

### Launch Day (Day 1)
| Metric | Target | Stretch |
|--------|--------|---------|
| HN rank | Top 10 | Front page (#1-5) |
| GitHub stars | 300+ | 1,000+ |
| Issues opened | 10+ | 30+ |
| Discord members | 50+ | 200+ |

### Week 1
| Metric | Target | Stretch |
|--------|--------|---------|
| GitHub stars | 1,000+ | 3,000+ |
| First community PR merged | 1+ | 5+ |
| Contributors | 5+ | 15+ |
| Discord members | 100+ | 500+ |

### Month 1
| Metric | Target | Stretch |
|--------|--------|---------|
| GitHub stars | 2,500+ | 5,000+ |
| Contributors | 20+ | 50+ |
| Community skills | 5+ | 15+ |
| Monthly active users | 500+ | 2,000+ |

### Month 6
| Metric | Target | Stretch |
|--------|--------|---------|
| GitHub stars | 5,000+ | 15,000+ |
| Contributors | 50+ | 150+ |
| Community skills | 20+ | 50+ |
| Monthly active users | 2,000+ | 10,000+ |
| Enterprise waitlist | 100+ | 500+ |

---

## Common Mistakes to Avoid

### 1. Launching without a demo
Developers don't read — they watch. A 30-second GIF showing the workflow is worth more than 2,000 words of README. **Non-negotiable**.

### 2. Ghost-town issues
Nothing kills momentum faster than unanswered issues. Commit to <24 hour response time for the first month. Even "Thanks for reporting, we'll look into this" is better than silence.

### 3. Ignoring first contributors
The first 10 contributors set the culture. Merge their PRs quickly (even if they need cleanup), thank them publicly, and give them context on the architecture. They become your evangelists.

### 4. Over-marketing, under-delivering
Don't promise multi-model support, web version, and team features in the launch post if they're months away. Be honest: "Claude-first today, multi-model is our top priority."

### 5. Conflating stars with product-market fit
Stars measure curiosity, not adoption. Track **clone count**, **issue engagement**, and **repeat contributors** as health metrics, not just the star counter.

### 6. No public roadmap
Developers contribute to projects with clear direction. A GitHub Projects board showing "what's next" gives potential contributors something to rally around.

### 7. Complex contribution setup
If a contributor can't build and run ChatML in under 10 minutes, you'll lose them. The CONTRIBUTING.md must be tested by someone who isn't the author.

### 8. Launching on Friday
Never launch on Friday. HN and Reddit engagement drops 40-60% over weekends. Tuesday/Wednesday morning (US Eastern) is optimal.

### 9. One-and-done launch
The launch post gets you attention for 48 hours. Sustained content (weekly blog posts, technical deep-dives, community calls) keeps the momentum going.

### 10. Not having "good first issues" ready
Day-one contributors need immediate tasks. Pre-seed 15-20 issues labeled `good first issue` with clear scope, acceptance criteria, and relevant file pointers.

---

## Budget Estimate (Optional Amplification)

If you want to invest marketing budget:

| Channel | Budget | Expected ROI |
|---------|--------|-------------|
| Twitter/X promoted post (launch GIF) | $500-1,000 | 50K-200K impressions |
| Product Hunt "ship" feature | $0 (free) | 2K-5K visits |
| YouTube sponsor (Fireship, Theo, etc.) | $2,000-5,000 | 50K-200K views |
| Dev.to sponsored post | $500 | 10K-30K reads |
| Conference sponsor (minor) | $1,000-3,000 | Credibility + networking |

**Recommendation**: Start with $0 budget. Organic HN + Reddit + Twitter is usually sufficient for dev tools. Invest in paid amplification only after validating product-market fit (month 2-3).
