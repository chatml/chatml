import { create } from 'zustand';

export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected';

interface ConnectionState {
  status: ConnectionStatus;
  reconnectAttempt: number;
  lastDisconnectedAt: number | null;

  setConnected: () => void;
  setDisconnected: () => void;
  setConnecting: (attempt: number) => void;
}

export const useConnectionStore = create<ConnectionState>()((set) => ({
  status: 'connecting',
  reconnectAttempt: 0,
  lastDisconnectedAt: null,

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
}));
