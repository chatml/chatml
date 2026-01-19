'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  checkSpeechAvailability,
  startSpeechRecognition,
  stopSpeechRecognition,
  listenForSpeechEvents,
  listenForSpeechErrors,
  SpeechEvent,
} from '@/lib/tauri';

export interface UseSpeechRecognitionResult {
  isListening: boolean;
  isAvailable: boolean;
  interimText: string;
  finalText: string;
  soundLevel: number;
  error: string | null;
  toggleListening: () => Promise<void>;
  startListening: () => Promise<void>;
  stopListening: () => Promise<void>;
}

export function useSpeechRecognition(): UseSpeechRecognitionResult {
  const [isListening, setIsListening] = useState(false);
  const [isAvailable, setIsAvailable] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [finalText, setFinalText] = useState('');
  const [soundLevel, setSoundLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const unlistenEventsRef = useRef<(() => void) | null>(null);
  const unlistenErrorsRef = useRef<(() => void) | null>(null);

  // Check availability on mount
  useEffect(() => {
    checkSpeechAvailability().then(setIsAvailable);
  }, []);

  // Handle speech events
  const handleSpeechEvent = useCallback((event: SpeechEvent) => {
    switch (event.type) {
      case 'ready':
        setIsListening(true);
        setError(null);
        setInterimText('');
        setFinalText('');
        break;
      case 'interim':
        setInterimText(event.text || '');
        break;
      case 'final':
        setFinalText(event.text || '');
        setInterimText('');
        break;
      case 'soundLevel':
        setSoundLevel(event.level || 0);
        break;
      case 'error':
        setError(event.message || 'Unknown error');
        setIsListening(false);
        break;
      case 'stopped':
        setIsListening(false);
        setSoundLevel(0);
        break;
    }
  }, []);

  // Handle speech errors
  const handleSpeechError = useCallback((errorMsg: string) => {
    setError(errorMsg);
    setIsListening(false);
  }, []);

  // Start listening
  const startListening = useCallback(async () => {
    if (!isAvailable || isListening) return;

    setError(null);
    setInterimText('');
    setFinalText('');

    // Set up event listeners
    unlistenEventsRef.current = await listenForSpeechEvents(handleSpeechEvent);
    unlistenErrorsRef.current = await listenForSpeechErrors(handleSpeechError);

    // Start recognition
    const success = await startSpeechRecognition();
    if (!success) {
      setError('Failed to start speech recognition');
      // Clean up listeners
      unlistenEventsRef.current?.();
      unlistenErrorsRef.current?.();
    }
  }, [isAvailable, isListening, handleSpeechEvent, handleSpeechError]);

  // Stop listening
  const stopListening = useCallback(async () => {
    if (!isListening) return;

    await stopSpeechRecognition();

    // Clean up listeners
    unlistenEventsRef.current?.();
    unlistenErrorsRef.current?.();
    unlistenEventsRef.current = null;
    unlistenErrorsRef.current = null;

    setIsListening(false);
    setSoundLevel(0);
  }, [isListening]);

  // Toggle listening
  const toggleListening = useCallback(async () => {
    if (isListening) {
      await stopListening();
    } else {
      await startListening();
    }
  }, [isListening, startListening, stopListening]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (isListening) {
        stopSpeechRecognition();
      }
      unlistenEventsRef.current?.();
      unlistenErrorsRef.current?.();
    };
  }, [isListening]);

  return {
    isListening,
    isAvailable,
    interimText,
    finalText,
    soundLevel,
    error,
    toggleListening,
    startListening,
    stopListening,
  };
}
