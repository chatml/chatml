import type { Message } from '@/lib/types';

export interface ConversationMarker {
  id: string;
  index: number;
  type: 'user' | 'plan';
  title: string;
}

/**
 * Extract navigation markers from a conversation's messages.
 * Returns markers for user turns and plan proposals.
 */
export function extractMarkers(messages: readonly Message[]): ConversationMarker[] {
  const markers: ConversationMarker[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.role === 'user' && msg.content.trim()) {
      markers.push({
        id: msg.id,
        index: i,
        type: 'user',
        title: truncate(msg.content, 60),
      });
    }

    // Plan proposals — from planContent or timeline plan entries
    const planEntry = msg.timeline?.find((e): e is Extract<typeof e, { type: 'plan' }> => e.type === 'plan');
    const planText = msg.planContent || planEntry?.content;

    if (planText) {
      markers.push({
        id: `${msg.id}-plan`,
        index: i,
        type: 'plan',
        title: truncate(planText, 60),
      });
    }
  }

  return markers;
}

function truncate(text: string, max: number): string {
  // Strip markdown heading prefixes and trim
  const cleaned = text.replace(/^#+\s+/, '').trim();
  if (cleaned.length <= max) return cleaned;
  return cleaned.slice(0, max).trimEnd() + '…';
}
