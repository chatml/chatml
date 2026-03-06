import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MentionText } from '../MentionText';

describe('MentionText', () => {
  describe('legitimate mentions (should render pills)', () => {
    it('renders mention at start of string', () => {
      const { container } = render(<MentionText content="@src/Button.tsx" />);
      const pill = container.querySelector('.inline-flex');
      expect(pill).toBeInTheDocument();
      expect(pill).toHaveTextContent('Button.tsx');
    });

    it('renders mention preceded by space', () => {
      const { container } = render(
        <MentionText content="Fix @src/Button.tsx please" />
      );
      const pill = container.querySelector('.inline-flex');
      expect(pill).toBeInTheDocument();
      expect(pill).toHaveTextContent('Button.tsx');
    });

    it('renders mention preceded by double quote', () => {
      const { container } = render(
        <MentionText content='Check "@src/Button.tsx" now' />
      );
      const pill = container.querySelector('.inline-flex');
      expect(pill).toBeInTheDocument();
      expect(pill).toHaveTextContent('Button.tsx');
    });

    it('renders mention preceded by single quote', () => {
      const { container } = render(
        <MentionText content="Check '@src/Button.tsx' now" />
      );
      const pill = container.querySelector('.inline-flex');
      expect(pill).toBeInTheDocument();
      expect(pill).toHaveTextContent('Button.tsx');
    });

    it('renders multiple mentions', () => {
      const { container } = render(
        <MentionText content="@src/a.ts and @src/b.ts" />
      );
      const pills = container.querySelectorAll('.inline-flex');
      expect(pills).toHaveLength(2);
      expect(pills[0]).toHaveTextContent('a.ts');
      expect(pills[1]).toHaveTextContent('b.ts');
    });

    it('renders mention after newline', () => {
      const { container } = render(
        <MentionText content={'line1\n@src/file.ts'} />
      );
      const pill = container.querySelector('.inline-flex');
      expect(pill).toBeInTheDocument();
      expect(pill).toHaveTextContent('file.ts');
    });
  });

  describe('false positives (should NOT render pills)', () => {
    it('does not match pnpm path with @ in package name', () => {
      const { container } = render(
        <MentionText content="node_modules/.pnpm/next@16.1.6_babel" />
      );
      const pills = container.querySelectorAll('.inline-flex');
      expect(pills).toHaveLength(0);
    });

    it('does not match pnpm path with multiple @ symbols', () => {
      const { container } = render(
        <MentionText content="core@7.29.0_react-dom@19.2.4_react@19.2.4" />
      );
      const pills = container.querySelectorAll('.inline-flex');
      expect(pills).toHaveLength(0);
    });

    it('does not match email-like patterns', () => {
      const { container } = render(
        <MentionText content="user@example.com" />
      );
      const pills = container.querySelectorAll('.inline-flex');
      expect(pills).toHaveLength(0);
    });

    it('does not match stack trace @ separator', () => {
      const { container } = render(
        <MentionText content="FileHistoryPanel@http://localhost:3100" />
      );
      const pills = container.querySelectorAll('.inline-flex');
      expect(pills).toHaveLength(0);
    });

    it('does not match npm scoped package in import statement', () => {
      const { container } = render(
        <MentionText content="import { File } from '@pierre/diffs'" />
      );
      const pills = container.querySelectorAll('.inline-flex');
      expect(pills).toHaveLength(0);
    });

    it('does not match npm scoped package with deep path', () => {
      const { container } = render(
        <MentionText content="from '@hooks/useResolvedThemeType'" />
      );
      const pills = container.querySelectorAll('.inline-flex');
      expect(pills).toHaveLength(0);
    });

    it('does not match bare npm scope', () => {
      const { container } = render(
        <MentionText content="@angular/core is a package" />
      );
      const pills = container.querySelectorAll('.inline-flex');
      expect(pills).toHaveLength(0);
    });

    it('does not match TypeScript path alias without extension', () => {
      const { container } = render(
        <MentionText content="import foo from '@/lib/utils'" />
      );
      const pills = container.querySelectorAll('.inline-flex');
      expect(pills).toHaveLength(0);
    });

    it('does not match full pnpm dependency string from log', () => {
      const content =
        'node_modules/.pnpm/next@16.1.6_babel+core@7.29.0_react-dom@19.2.4_react@19.2.4__react-dom@19.2.4/node_modules/react-dom/cjs/react-dom-client.development.js';
      const { container } = render(<MentionText content={content} />);
      const pills = container.querySelectorAll('.inline-flex');
      expect(pills).toHaveLength(0);
    });
  });

  describe('mixed content', () => {
    it('renders pill for file mention but not npm scoped package', () => {
      const { container } = render(
        <MentionText content="Check @src/Button.tsx but not @angular/core" />
      );
      const pills = container.querySelectorAll('.inline-flex');
      expect(pills).toHaveLength(1);
      expect(pills[0]).toHaveTextContent('Button.tsx');
    });

    it('preserves npm scoped package text when not rendering as pill', () => {
      const { container } = render(
        <MentionText content="import from '@pierre/diffs'" />
      );
      expect(container.textContent).toBe("import from '@pierre/diffs'");
    });
  });

  describe('extensionless files', () => {
    it('renders pill for @Makefile', () => {
      const { container } = render(
        <MentionText content="check @Makefile for build targets" />
      );
      const pills = container.querySelectorAll('.inline-flex');
      expect(pills).toHaveLength(1);
      expect(pills[0]).toHaveTextContent('Makefile');
    });

    it('renders pill for @Dockerfile', () => {
      const { container } = render(
        <MentionText content="see @Dockerfile" />
      );
      const pills = container.querySelectorAll('.inline-flex');
      expect(pills).toHaveLength(1);
      expect(pills[0]).toHaveTextContent('Dockerfile');
    });

    it('renders pill for extensionless file in a path', () => {
      const { container } = render(
        <MentionText content="check @src/Makefile" />
      );
      const pills = container.querySelectorAll('.inline-flex');
      expect(pills).toHaveLength(1);
      expect(pills[0]).toHaveTextContent('Makefile');
    });
  });

  describe('edge cases', () => {
    it('renders plain text without @ as plain span', () => {
      render(<MentionText content="No mentions here" />);
      expect(screen.getByText('No mentions here')).toBeInTheDocument();
    });

    it('handles empty string', () => {
      const { container } = render(<MentionText content="" />);
      expect(container.querySelector('.inline-flex')).not.toBeInTheDocument();
    });

    it('does not match bare @ with no path after it', () => {
      const { container } = render(<MentionText content="@ " />);
      const pills = container.querySelectorAll('.inline-flex');
      expect(pills).toHaveLength(0);
    });
  });
});
