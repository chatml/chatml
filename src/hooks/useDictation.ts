'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
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
  const [isDictating, setIsDictating] = useState(false);
  const [isAvailable, setIsAvailable] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const isDictatingRef = useRef(false);
  isDictatingRef.current = isDictating;

  // Check availability on mount
  useEffect(() => {
    if (!isMacOS()) {
      setIsAvailable(false);
      return;
    }

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
        setIsDictating(false);
        setAudioLevel(0);
        optionsRef.current.onError?.(payload.message);
      }),
      safeListen<void>('dictation-ended', () => {
        setIsDictating(false);
        setAudioLevel(0);
        optionsRef.current.onEnd?.();
      }),
    ];

    return () => {
      promises.forEach((p) => p.then((unlisten) => unlisten()));
    };
  }, [isAvailable]);

  // Stop dictation on unmount if active
  useEffect(() => {
    return () => {
      if (isDictatingRef.current) {
        safeInvoke('stop_dictation');
      }
    };
  }, []);

  const toggle = useCallback(async () => {
    if (!isAvailable) return;

    if (isDictating) {
      await safeInvoke('stop_dictation');
      setIsDictating(false);
      setAudioLevel(0);
    } else {
      const result = await safeInvoke('start_dictation');
      if (result !== null) {
        // start_dictation returns Ok(()) on success, error string on failure
        setIsDictating(true);
      } else {
        // safeInvoke returns null on error (already logged)
        // Re-check permissions in case they were denied
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
  }, [isAvailable, isDictating]);

  return { isDictating, toggle, isAvailable, audioLevel };
}
