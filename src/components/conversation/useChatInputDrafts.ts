import { useEffect, useRef } from 'react';
import { useAppStore } from '@/stores/appStore';
import type { PlateInputHandle } from './PlateInput';
import type { Attachment } from '@/lib/types';

/**
 * Manages save/restore of compose drafts across session switches and unmounts.
 * Ensures switching sessions doesn't lose or leak input state.
 */
export function useChatInputDrafts({
  selectedSessionId,
  plateInputRef,
  messageRef,
  attachmentsRef,
  currentSessionIdRef,
  setMessage,
  setAttachments,
  setDraftInput,
  clearDraftInput,
}: {
  selectedSessionId: string | null;
  plateInputRef: React.RefObject<PlateInputHandle | null>;
  messageRef: React.RefObject<string>;
  attachmentsRef: React.RefObject<Attachment[]>;
  currentSessionIdRef: React.RefObject<string | null>;
  setMessage: (msg: string) => void;
  setAttachments: (attachments: Attachment[]) => void;
  setDraftInput: (sessionId: string, draft: { text: string; attachments: Attachment[] }) => void;
  clearDraftInput: (sessionId: string) => void;
}) {
  // Save draft on unmount — catches navigation away (contentView changes),
  // component teardown, and any other unmount scenario not covered by the
  // session-switch effect below.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally reads refs at cleanup time; these refs are stable across the component lifetime
  useEffect(() => {
    return () => {
      const sessionId = currentSessionIdRef.current;
      if (!sessionId) return;
      const currentText = plateInputRef.current?.getText() ?? messageRef.current ?? '';
      const currentAttachments = attachmentsRef.current;
      if (currentText || currentAttachments.length > 0) {
        useAppStore.getState().setDraftInput(sessionId, {
          text: currentText,
          attachments: currentAttachments,
        });
      } else {
        useAppStore.getState().clearDraftInput(sessionId);
      }
    };
  }, []);

  // Save/restore compose draft per session so switching sessions doesn't lose or leak input.
  // Initialized to null (not selectedSessionId) so the first run restores any persisted draft.
  const prevSessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    const prevId = prevSessionIdRef.current;
    if (prevId === selectedSessionId) return;

    // Save draft for the previous session
    if (prevId) {
      const currentText = plateInputRef.current?.getText() ?? '';
      const currentAttachments = attachmentsRef.current;
      if (currentText || currentAttachments.length > 0) {
        setDraftInput(prevId, { text: currentText, attachments: currentAttachments });
      } else {
        clearDraftInput(prevId);
      }
    }

    // Restore draft for the new session (or clear)
    const draft = selectedSessionId ? useAppStore.getState().draftInputs[selectedSessionId] : undefined;
    if (draft) {
      plateInputRef.current?.setText(draft.text);
      setMessage(draft.text);
      setAttachments(draft.attachments);
      clearDraftInput(selectedSessionId!);
    } else {
      plateInputRef.current?.clear();
      setMessage('');
      setAttachments([]);
    }

    prevSessionIdRef.current = selectedSessionId;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only run on session switch
  }, [selectedSessionId]);
}
