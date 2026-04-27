import type { Value } from 'platejs';

/**
 * Extract plain text and mentioned file IDs from a Plate.js value tree.
 *
 * Walks the node tree, concatenating text content and capturing mention values
 * separately so the caller can attach mentioned files to outgoing messages.
 *
 * Performance: uses array-join instead of string concatenation, which keeps
 * deeply-nested or large pasted content from quadratic copy cost.
 */
export function extractContent(value: Value): {
  text: string;
  mentionedFiles: string[];
} {
  const parts: string[] = [];
  const mentionedFiles: string[] = [];

  // Defensive depth cap. Plate's own pipeline limits depth, but content can
  // arrive from external clipboard / drag-drop sources, and an unbounded
  // recursion would blow the stack on a pathological / cyclic Value.
  const MAX_DEPTH = 200;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Plate nodes have dynamic structure
  const processNode = (node: any, depth: number = 0) => {
    if (depth > MAX_DEPTH) return;
    if (node.text !== undefined) {
      parts.push(node.text);
    } else if (node.type === 'mention') {
      parts.push(`@${node.value}`);
      if (node.value) {
        mentionedFiles.push(node.value);
      }
    } else if (node.children) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Plate nodes have dynamic structure
      node.children.forEach((child: any) => processNode(child, depth + 1));
    }
  };

  value.forEach((node, index) => {
    processNode(node);
    // Add newline between paragraphs (except after last one)
    if (index < value.length - 1) {
      parts.push('\n');
    }
  });

  return { text: parts.join('').trim(), mentionedFiles };
}
