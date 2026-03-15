// Ref-counted map of conversations currently being reconciled from a streaming snapshot.
// Content events for these conversations are dropped to prevent the snapshot + live event
// race condition that causes duplicate tools and text.
// Uses a counter (not a Set) so concurrent reconnects don't prematurely clear the flag
// when the first reconciliation finishes while the second is still in-flight.
const reconcilingConversations = new Map<string, number>();

export function startReconciling(convId: string) {
  reconcilingConversations.set(convId, (reconcilingConversations.get(convId) ?? 0) + 1);
}

export function stopReconciling(convId: string) {
  const count = (reconcilingConversations.get(convId) ?? 1) - 1;
  if (count <= 0) {
    reconcilingConversations.delete(convId);
  } else {
    reconcilingConversations.set(convId, count);
  }
}

export function isReconciling(convId: string): boolean {
  return (reconcilingConversations.get(convId) ?? 0) > 0;
}

// Clear reconciliation state for a specific conversation (used during cleanup)
export function clearReconciliationState(convId: string) {
  reconcilingConversations.delete(convId);
}
