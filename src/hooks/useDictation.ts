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
  onTranscript: (text: string, isFinal: boolean) => void;
  onError?: (message: string) => void;
  onEnd?: () => void;
}

interface UseDictationReturn {
  isDictating: boolean;
  toggle: () => void;
  isAvailable: boolean;
  audioLevel: number;
}

export function useDictation(options: UseDictationOptions): UseDictationReturn {
  const [isDictating, setIsDictatingState] = useState(false);
  const [isAvailable, setIsAvailable] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const optionsRef = useRef(options);
  const isDictatingRef = useRef(false);
  const togglingRef = useRef(false);

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
        optionsRef.current.onTranscript(payload.text, payload.is_final);
      }),
      safeListen<DictationAudioLevel>('dictation-audio-level', (payload) => {
        setAudioLevel(payload.level);
      }),
      safeListen<DictationError>('dictation-error', (payload) => {
        setDictating(false);
        setAudioLevel(0);
        optionsRef.current.onError?.(payload.message);
      }),
      safeListen<void>('dictation-ended', () => {
        setDictating(false);
        setAudioLevel(0);
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
        // Use raw invoke (not safeInvoke) so stop errors are visible and don't silently desync UI
        try {
          await invoke('stop_dictation');
        } catch (e: unknown) {
          const errMsg = e instanceof Error ? e.message : String(e);
          optionsRef.current.onError?.(`Failed to stop dictation: ${errMsg}`);
          return;
        }
        setDictating(false);
        setAudioLevel(0);
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
            setAudioLevel(0);
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

  return { isDictating, toggle, isAvailable, audioLevel };
}
