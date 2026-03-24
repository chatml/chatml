'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { safeInvoke, safeListen } from '@/lib/tauri';
import { isMacOS } from '@/lib/platform';

type DictationPermissionStatus =
  | 'granted'
  | 'denied'
  | 'restricted'
  | 'notDetermined'
  | 'unavailable';

interface DictationTranscript {
  text: string;
  is_final: boolean;
}

interface DictationAudioLevel {
  level: number;
}

interface DictationError {
  message: string;
}

interface UseDictationOptions {
  onTranscript: (text: string) => void;
  onError?: (message: string) => void;
  onEnd?: () => void;
}

interface UseDictationReturn {
  isDictating: boolean;
  toggle: () => void;
  isAvailable: boolean;
  audioLevelRef: React.RefObject<number>;
}

export function useDictation(options: UseDictationOptions): UseDictationReturn {
  const [isDictating, setIsDictatingState] = useState(false);
  const [isAvailable, setIsAvailable] = useState(false);
  const audioLevelRef = useRef(0);
  const optionsRef = useRef(options);
  const isDictatingRef = useRef(false);
  const togglingRef = useRef(false);
  // Tracks whether an explicit stop is in progress — used to suppress the
  // spurious "no speech detected" error Apple fires during session teardown.
  const isStoppingRef = useRef(false);

  useEffect(() => {
    optionsRef.current = options;
  });

  // Synchronously update both ref and state to avoid stale closures
  const setDictating = useCallback((value: boolean) => {
    isDictatingRef.current = value;
    setIsDictatingState(value);
  }, []);

  // Check availability on mount (isAvailable starts as false, so non-macOS needs no setState)
  useEffect(() => {
    if (!isMacOS()) return;

    safeInvoke<DictationPermissionStatus>('check_dictation_permissions').then(
      (status) => {
        // Available if we can potentially use it (granted or not yet asked)
        setIsAvailable(
          status === 'granted' || status === 'notDetermined'
        );
      }
    );
  }, []);

  // Listen for Tauri events
  useEffect(() => {
    if (!isAvailable) return;

    const promises = [
      safeListen<DictationTranscript>('dictation-transcript', (payload) => {
        optionsRef.current.onTranscript(payload.text);
      }),
      safeListen<DictationAudioLevel>('dictation-audio-level', (payload) => {
        audioLevelRef.current = payload.level;
      }),
      safeListen<DictationError>('dictation-error', (payload) => {
        // Apple's SFSpeechRecognizer fires a spurious "No speech detected" error
        // during session teardown after cancelling the recognition task. Suppress
        // it only when we know an explicit stop is in progress — the Rust-side
        // stopped_for_result flag handles the same race but has a narrow window
        // before the AtomicBool is set; this is the JS-side safety net.
        if (
          isStoppingRef.current &&
          payload.message.toLowerCase().includes('no speech detected')
        ) {
          return;
        }
        setDictating(false);
        audioLevelRef.current = 0;
        optionsRef.current.onError?.(payload.message);
      }),
      safeListen<void>('dictation-ended', () => {
        setDictating(false);
        audioLevelRef.current = 0;
        isStoppingRef.current = false;
        optionsRef.current.onEnd?.();
      }),
    ];

    return () => {
      promises.forEach((p) => p.then((unlisten) => unlisten()));
    };
  }, [isAvailable, setDictating]);

  // Stop dictation on unmount if active
  useEffect(() => {
    return () => {
      if (isDictatingRef.current) {
        safeInvoke('stop_dictation');
      }
    };
  }, []);

  const toggle = useCallback(async () => {
    if (!isAvailable || togglingRef.current) return;
    togglingRef.current = true;

    try {
      if (isDictatingRef.current) {
        isStoppingRef.current = true;
        // Use raw invoke (not safeInvoke) so stop errors are visible and don't silently desync UI
        try {
          await invoke('stop_dictation');
        } catch (e: unknown) {
          isStoppingRef.current = false;
          const errMsg = e instanceof Error ? e.message : String(e);
          optionsRef.current.onError?.(`Failed to stop dictation: ${errMsg}`);
          return;
        }
        setDictating(false);
        audioLevelRef.current = 0;
        // isStoppingRef is reset when dictation-ended fires
      } else {
        try {
          // Use raw invoke (not safeInvoke) so we can inspect the error for "already active" desync recovery
          await invoke('start_dictation');
          setDictating(true);
        } catch (e: unknown) {
          const errMsg = e instanceof Error ? e.message : String(e);
          // Rust backend emits "already active" when dictation is running but frontend state was out of sync
          if (errMsg.includes('already active')) {
            // Backend thinks dictation is active but frontend didn't know — stop it (resilient toggle)
            try {
              await invoke('stop_dictation');
            } catch {
              // Best-effort recovery — if stop also fails, just reset UI state
            }
            setDictating(false);
            audioLevelRef.current = 0;
          } else {
            // Permission or other error — re-check permissions
            const status = await safeInvoke<DictationPermissionStatus>(
              'check_dictation_permissions'
            );
            if (status === 'denied' || status === 'restricted') {
              setIsAvailable(false);
              optionsRef.current.onError?.(
                'Speech recognition permission denied. Enable it in System Settings > Privacy & Security.'
              );
            }
          }
        }
      }
    } finally {
      togglingRef.current = false;
    }
  }, [isAvailable, setDictating]);

  return { isDictating, toggle, isAvailable, audioLevelRef };
}
