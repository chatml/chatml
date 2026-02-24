import { create } from 'zustand';

export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected';

export type SidecarState = 'running' | 'restarting' | 'failed';

interface ConnectionState {
  status: ConnectionStatus;
  reconnectAttempt: number;
  lastDisconnectedAt: number | null;

  // Sidecar lifecycle state
  sidecarState: SidecarState;
  sidecarRestartAttempt: number;
  sidecarMaxRestartAttempts: number;

  setConnected: () => void;
  setDisconnected: () => void;
  setConnecting: (attempt: number) => void;

  setSidecarRestarting: (attempt: number, maxAttempts?: number) => void;
  setSidecarRunning: () => void;
  setSidecarFailed: () => void;
}

export const useConnectionStore = create<ConnectionState>()((set) => ({
  status: 'connecting',
  reconnectAttempt: 0,
  lastDisconnectedAt: null,

  sidecarState: 'running',
  sidecarRestartAttempt: 0,
  sidecarMaxRestartAttempts: 3,

  setConnected: () =>
    set({
      status: 'connected',
      reconnectAttempt: 0,
      lastDisconnectedAt: null,
    }),

  setDisconnected: () =>
    set((state) => ({
      status: 'disconnected',
      lastDisconnectedAt:
        state.status !== 'disconnected' ? Date.now() : state.lastDisconnectedAt,
    })),

  setConnecting: (attempt: number) =>
    set({
      status: 'connecting',
      reconnectAttempt: attempt,
    }),

  setSidecarRestarting: (attempt: number, maxAttempts?: number) =>
    set((state) => ({
      sidecarState: 'restarting',
      sidecarRestartAttempt: attempt,
      sidecarMaxRestartAttempts: maxAttempts ?? state.sidecarMaxRestartAttempts,
    })),

  setSidecarRunning: () =>
    set({
      sidecarState: 'running',
      sidecarRestartAttempt: 0,
    }),

  setSidecarFailed: () =>
    set((state) => ({
      sidecarState: 'failed',
      // Preserve the last attempt number so the UI can show it
      sidecarRestartAttempt: state.sidecarRestartAttempt,
    })),
}));
