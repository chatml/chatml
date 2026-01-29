/**
 * Rehype plugin that wraps emoji characters in <span class="emoji">
 * so they can be styled (e.g. scaled down) via CSS.
 */
import type { Root, Text, ElementContent } from 'hast';

// Matches most emoji: emoticons, dingbats, symbols, flags, skin tones, etc.
const EMOJI_RE =
  /(\p{Emoji_Presentation}|\p{Extended_Pictographic})/gu;

function wrapEmoji(node: Text): ElementContent[] {
  const parts: ElementContent[] = [];
  let lastIndex = 0;

  for (const match of node.value.matchAll(EMOJI_RE)) {
    const idx = match.index!;
    // Text before emoji
    if (idx > lastIndex) {
      parts.push({ type: 'text', value: node.value.slice(lastIndex, idx) });
    }
    // Wrapped emoji
    parts.push({
      type: 'element',
      tagName: 'span',
      properties: { className: ['emoji'] },
      children: [{ type: 'text', value: match[0] }],
    });
    lastIndex = idx + match[0].length;
  }

  // Trailing text
  if (lastIndex < node.value.length) {
    parts.push({ type: 'text', value: node.value.slice(lastIndex) });
  }

  return parts;
}

function visit(node: Root | ElementContent): void {
  if (!('children' in node)) return;

  const newChildren: ElementContent[] = [];
  let changed = false;

  for (const child of node.children as ElementContent[]) {
    if (child.type === 'text' && EMOJI_RE.test(child.value)) {
      // Reset regex lastIndex since we used .test()
      EMOJI_RE.lastIndex = 0;
      const wrapped = wrapEmoji(child);
      newChildren.push(...wrapped);
      changed = true;
    } else {
      // Recurse into element children (but skip <pre>/<code> blocks)
      if (child.type === 'element' && child.tagName !== 'pre' && child.tagName !== 'code') {
        visit(child);
      }
      newChildren.push(child);
    }
  }

  if (changed) {
    (node as Root).children = newChildren as Root['children'];
  }
}

export function rehypeEmoji() {
  return (tree: Root) => {
    visit(tree);
  };
}
