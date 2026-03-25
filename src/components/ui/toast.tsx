'use client';

import * as React from 'react';
import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Copy, Check, Info, X } from 'lucide-react';
import { copyToClipboard } from '@/lib/tauri';
import { COPY_FEEDBACK_DURATION_MS } from '@/lib/constants';
import { cn } from '@/lib/utils';

// Toast types
type ToastType = 'error' | 'success' | 'info' | 'warning';

interface Toast {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
  duration?: number;
}

interface ToastContextValue {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
  // Convenience methods
  error: (message: string, title?: string) => void;
  success: (message: string, title?: string) => void;
  info: (message: string, title?: string) => void;
  warning: (message: string, title?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

// Default durations
const DEFAULT_DURATION: Record<ToastType, number> = {
  error: 6000,
  success: 3000,
  info: 4000,
  warning: 5000,
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((prev) => [...prev, { ...toast, id }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const error = useCallback(
    (message: string, title?: string) => {
      addToast({ type: 'error', message, title, duration: DEFAULT_DURATION.error });
    },
    [addToast]
  );

  const success = useCallback(
    (message: string, title?: string) => {
      addToast({ type: 'success', message, title, duration: DEFAULT_DURATION.success });
    },
    [addToast]
  );

  const info = useCallback(
    (message: string, title?: string) => {
      addToast({ type: 'info', message, title, duration: DEFAULT_DURATION.info });
    },
    [addToast]
  );

  const warning = useCallback(
    (message: string, title?: string) => {
      addToast({ type: 'warning', message, title, duration: DEFAULT_DURATION.warning });
    },
    [addToast]
  );

  // Memoize the context value so consumers that only use the action functions
  // (error, success, etc.) don't re-render when the toasts array changes.
  const contextValue = useMemo(
    () => ({ toasts, addToast, removeToast, error, success, info, warning }),
    [toasts, addToast, removeToast, error, success, info, warning]
  );

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <Toaster />
    </ToastContext.Provider>
  );
}

// No-op fallback for SSR/outside provider - logs to console instead
const noopToast: ToastContextValue = {
  toasts: [],
  addToast: () => {},
  removeToast: () => {},
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  error: (message: string, _title?: string) => console.error('[Toast]', message),
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  success: (message: string, _title?: string) => console.log('[Toast]', message),
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  info: (message: string, _title?: string) => console.info('[Toast]', message),
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  warning: (message: string, _title?: string) => console.warn('[Toast]', message),
};

export function useToast() {
  const context = useContext(ToastContext);
  // Return no-op fallback during SSR or when outside provider
  // This prevents build errors while still logging messages
  if (!context) {
    return noopToast;
  }
  return context;
}

// Icons for each toast type
const ToastIcon: Record<ToastType, React.ElementType> = {
  error: AlertCircle,
  success: CheckCircle2,
  info: Info,
  warning: AlertTriangle,
};

// Colors for each toast type
const toastStyles: Record<ToastType, string> = {
  error: 'bg-destructive/10 border-destructive/30 text-destructive',
  success: 'bg-text-success/10 border-text-success/30 text-text-success',
  info: 'bg-text-info/10 border-text-info/30 text-text-info',
  warning: 'bg-yellow-500/10 border-yellow-500/30 text-yellow-600 dark:text-yellow-400',
};

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: () => void }) {
  const [isLeaving, setIsLeaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const copyTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const duration = toast.duration ?? DEFAULT_DURATION[toast.type];
    timerRef.current = setTimeout(() => {
      setIsLeaving(true);
      setTimeout(onRemove, 200); // Wait for exit animation
    }, duration);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, [toast, onRemove]);

  const handleDismiss = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setIsLeaving(true);
    setTimeout(onRemove, 200);
  };

  const handleCopy = async () => {
    const text = [toast.title, toast.message].filter(Boolean).join(': ');
    const success = await copyToClipboard(text);
    if (success) {
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), COPY_FEEDBACK_DURATION_MS);
    }
  };

  const Icon = ToastIcon[toast.type];

  return (
    <div
      role="alert"
      aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
      className={cn(
        'flex items-start gap-3 p-3 rounded-lg border shadow-lg backdrop-blur-sm',
        'transition-all duration-200 ease-out',
        isLeaving ? 'opacity-0 translate-x-4' : 'opacity-100 translate-x-0',
        toastStyles[toast.type]
      )}
    >
      <Icon className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        {toast.title && (
          <p className="text-sm font-medium">{toast.title}</p>
        )}
        <p className={cn('text-sm', toast.title && 'text-foreground')}>
          {toast.message}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {(toast.type === 'error' || toast.type === 'warning') && (
          <button
            onClick={handleCopy}
            className="rounded-sm opacity-70 hover:opacity-100 transition-opacity"
            aria-label="Copy message"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        )}
        <button
          onClick={handleDismiss}
          className="rounded-sm opacity-70 hover:opacity-100 transition-opacity"
          aria-label="Dismiss notification"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function Toaster() {
  const { toasts, removeToast } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm pointer-events-none"
      aria-label="Notifications"
    >
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <ToastItem toast={toast} onRemove={() => removeToast(toast.id)} />
        </div>
      ))}
    </div>
  );
}
