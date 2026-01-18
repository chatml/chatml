# ChatML

A desktop application for AI-powered conversations built with Tauri, Next.js, and Claude Agent SDK.

## Features

- Conversational AI interface with Claude Agent SDK integration
- File viewer with syntax highlighting
- Session persistence across restarts
- Dynamic action sidebar with drag-and-drop support
- Git diff visualization
- Dark mode support
- Real-time chat with WebSocket connections

## Tech Stack

### Frontend
- [Next.js 16](https://nextjs.org) - React framework with Turbopack
- [React 19](https://react.dev) - UI library
- [Tailwind CSS 4](https://tailwindcss.com) - Styling
- [Radix UI](https://www.radix-ui.com) - Accessible component primitives
- [Zustand](https://github.com/pmndrs/zustand) - State management
- [Shiki](https://shiki.style) - Syntax highlighting

### Backend
- [Tauri 2](https://tauri.app) - Desktop application framework
- [Rust](https://www.rust-lang.org) - Backend runtime

### Key Libraries
- `@dnd-kit` - Drag and drop functionality
- `react-markdown` with `remark-gfm` - Markdown rendering
- `@git-diff-view` - Git diff visualization
- `lucide-react` - Icons

## Prerequisites

Before you begin, ensure you have the following installed:

- [Node.js](https://nodejs.org) (v20 or higher)
- [Rust](https://www.rust-lang.org/tools/install)
- [Tauri CLI prerequisites](https://tauri.app/start/prerequisites/)

## Getting Started

1. Clone the repository:
```bash
git clone <your-repo-url>
cd chatml
```

2. Install dependencies:
```bash
npm install
```

3. Run the development server:
```bash
npm run tauri:dev
```

This will start both the Next.js frontend and the Tauri backend in development mode.

For frontend-only development:
```bash
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000) in your browser.

## Available Scripts

- `npm run dev` - Start Next.js development server with Turbopack
- `npm run tauri:dev` - Start Tauri development mode (frontend + backend)
- `npm run tauri:build` - Build the production desktop application
- `npm run build` - Build Next.js for production
- `npm run start` - Start Next.js production server
- `npm run lint` - Run ESLint

## Building for Production

To create a production build of the desktop application:

```bash
npm run tauri:build
```

The built application will be available in `src-tauri/target/release/bundle/`.

## Project Structure

```
chatml/
├── src/                    # Next.js frontend source
│   ├── app/               # Next.js app directory
│   ├── components/        # React components
│   ├── hooks/            # Custom React hooks
│   ├── lib/              # Utility functions and types
│   └── stores/           # Zustand state stores
├── src-tauri/            # Tauri backend
│   ├── src/             # Rust source code
│   └── tauri.conf.json  # Tauri configuration
├── agent-runner/         # Claude Agent SDK integration
└── public/              # Static assets
```

## Development

### Frontend Development

The frontend is built with Next.js and uses:
- App Router for routing
- Server and Client Components
- Tailwind CSS for styling
- Radix UI for accessible components

### Backend Development

The Tauri backend is written in Rust and handles:
- Native system integration
- File system operations
- Process management
- WebSocket connections

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [Tauri Documentation](https://tauri.app)
- [React Documentation](https://react.dev)
- [Rust Documentation](https://doc.rust-lang.org)
