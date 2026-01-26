'use client';

import * as React from 'react';
import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';

// Toast types
type ToastType = 'error' | 'success' | 'info';

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
}

const ToastContext = createContext<ToastContextValue | null>(null);

// Default durations
const DEFAULT_DURATION: Record<ToastType, number> = {
  error: 6000,
  success: 3000,
  info: 4000,
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

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast, error, success, info }}>
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
};

export function useToast() {
  const context = useContext(ToastContext);
  // Return no-op fallback during SSR or when outside provider
  // This prevents build errors while still logging messages
  if (!context) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('useToast called outside ToastProvider - using no-op fallback');
    }
    return noopToast;
  }
  return context;
}

// Icons for each toast type
const ToastIcon: Record<ToastType, React.ElementType> = {
  error: AlertCircle,
  success: CheckCircle2,
  info: Info,
};

// Colors for each toast type
const toastStyles: Record<ToastType, string> = {
  error: 'bg-destructive/10 border-destructive/30 text-destructive',
  success: 'bg-text-success/10 border-text-success/30 text-text-success',
  info: 'bg-text-info/10 border-text-info/30 text-text-info',
};

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: () => void }) {
  const [isLeaving, setIsLeaving] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const duration = toast.duration ?? DEFAULT_DURATION[toast.type];
    timerRef.current = setTimeout(() => {
      setIsLeaving(true);
      setTimeout(onRemove, 200); // Wait for exit animation
    }, duration);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [toast, onRemove]);

  const handleDismiss = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setIsLeaving(true);
    setTimeout(onRemove, 200);
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
      <button
        onClick={handleDismiss}
        className="shrink-0 rounded-sm opacity-70 hover:opacity-100 transition-opacity"
        aria-label="Dismiss notification"
      >
        <X className="w-4 h-4" />
      </button>
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
