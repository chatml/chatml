# Mermaid Diagram Rendering

## Overview

Render Mermaid graph code blocks in agent messages as interactive SVG diagrams with zoom and pan support.

## Architecture

### New Components

**MermaidDiagram.tsx**
- Takes mermaid code string as input
- Uses mermaid.js to render SVG
- Wraps in react-zoom-pan-pinch for interactivity
- Provides zoom controls (+, -, reset)
- Handles loading and error states
- Respects dark/light theme

**MarkdownCodeBlock.tsx**
- Custom code block renderer for ReactMarkdown
- Detects `language-mermaid` class
- Routes to MermaidDiagram or default syntax highlighting

### Modified Files

**StreamingMessage.tsx**
- Add `components={{ code: MarkdownCodeBlock }}` to ReactMarkdown

**ConversationArea.tsx**
- Add `components={{ code: MarkdownCodeBlock }}` to ReactMarkdown

## Dependencies

```json
{
  "mermaid": "^11.x",
  "react-zoom-pan-pinch": "^3.x"
}
```

## UI Design

```
┌─────────────────────────────────────────┐
│ [+] [-] [⟲]                   Mermaid  │
├─────────────────────────────────────────┤
│                                         │
│         ┌───────┐    ┌───────┐         │
│         │   A   │───▶│   B   │         │
│         └───────┘    └───────┘         │
│                                         │
└─────────────────────────────────────────┘
```

## Interactions

- Mouse wheel: zoom in/out
- Drag: pan
- Double-click: reset zoom
- Touch gestures: pinch to zoom, drag to pan
- Control buttons: +, -, reset

## Error Handling

Invalid mermaid syntax displays:
- Error message
- Raw code block as fallback

## Theme Support

Mermaid initialized with theme based on system preference:
- Light mode: `default` theme
- Dark mode: `dark` theme
