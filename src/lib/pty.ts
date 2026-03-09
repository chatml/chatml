import { invoke } from '@tauri-apps/api/core';

export interface PtySpawnOptions {
  cols?: number;
  rows?: number;
  cwd?: string;
  env?: Record<string, string>;
}

export interface PtyHandle {
  pid: number;
  /** Shared flag — true once kill() or stopReading() has been called. */
  stopped: boolean;
  write(data: string): Promise<void>;
  resize(cols: number, rows: number): Promise<void>;
  kill(): Promise<void>;
}

/**
 * Spawn a PTY process. Unlike tauri-pty's spawn(), this is truly async —
 * the returned Promise rejects if the spawn fails, enabling proper error
 * handling and shell fallback chains.
 *
 * Call `startPtyReading()` after setting up event handlers to begin the data loop.
 */
export async function spawnPty(
  file: string,
  args: string[],
  options: PtySpawnOptions = {},
): Promise<PtyHandle> {
  const pid = await invoke<number>('plugin:pty|spawn', {
    file,
    args,
    termName: 'xterm-256color',
    cols: options.cols ?? 80,
    rows: options.rows ?? 24,
    cwd: options.cwd ?? null,
    env: options.env ?? {},
    encoding: null,
    handleFlowControl: null,
    flowControlPause: null,
    flowControlResume: null,
  });

  const handle: PtyHandle = {
    pid,
    stopped: false,

    async write(data: string) {
      if (handle.stopped) return;
      await invoke('plugin:pty|write', { pid, data });
    },

    async resize(cols: number, rows: number) {
      if (handle.stopped) return;
      await invoke('plugin:pty|resize', { pid, cols, rows });
    },

    async kill() {
      if (handle.stopped) return;
      handle.stopped = true;
      try {
        await invoke('plugin:pty|kill', { pid });
      } catch {
        // Process may have already exited
      }
    },
  };

  return handle;
}

/**
 * Start the read and wait loops for a PTY handle.
 * Returns a cleanup function that stops both loops.
 *
 * Uses the handle's shared `stopped` flag so that calling `pty.kill()`
 * also halts the read loop without requiring a separate stop call.
 */
export function startPtyReading(
  pty: PtyHandle,
  callbacks: {
    onData: (data: Uint8Array) => void;
    onExit: (exitCode: number) => void;
  },
): () => void {
  const MAX_BACKOFF_MS = 1000;

  // RAF-based batching: accumulate chunks and flush once per frame
  // to avoid per-chunk xterm.js render passes that cause visual stuttering.
  let pending: Uint8Array[] = [];
  let rafId: number | null = null;

  const flush = () => {
    rafId = null;
    if (pending.length === 0) return;
    const total = pending.reduce((sum, a) => sum + a.length, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of pending) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    pending = [];
    callbacks.onData(merged);
  };

  // Read loop: polls plugin:pty|read until EOF or stopped
  const readLoop = async () => {
    let backoff = 50;
    while (!pty.stopped) {
      try {
        const data = await invoke<number[]>('plugin:pty|read', { pid: pty.pid });
        backoff = 50; // reset on success
        if (!pty.stopped) {
          pending.push(new Uint8Array(data));
          if (rafId === null) {
            rafId = requestAnimationFrame(flush);
          }
        }
      } catch (e: unknown) {
        if (pty.stopped) break;
        // Treat any error that looks like EOF as a clean exit.
        // Also treat empty/falsy errors as EOF — the plugin may
        // signal end-of-stream in different ways across versions.
        if (isEofError(e)) {
          break;
        }
        console.warn('PTY read error:', e);
        await new Promise(r => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      }
    }
    // Flush any remaining data after loop exits
    if (pending.length > 0) flush();
  };

  // Wait loop: blocks until process exits, then fires onExit
  const waitLoop = async () => {
    try {
      const exitCode = await invoke<number>('plugin:pty|exitstatus', { pid: pty.pid });
      if (!pty.stopped) {
        pty.stopped = true;
        callbacks.onExit(exitCode);
      }
    } catch {
      if (!pty.stopped) {
        pty.stopped = true;
        callbacks.onExit(-1);
      }
    }
  };

  readLoop();
  waitLoop();

  return () => {
    pty.stopped = true;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    // Discard any buffered data — the consumer's onData callback
    // is guarded by cleanupCalled and would drop it anyway.
    pending = [];
  };
}

/** Detect EOF-like errors from the PTY read command. */
function isEofError(e: unknown): boolean {
  if (typeof e === 'string') {
    const lower = e.toLowerCase();
    return lower.includes('eof') || lower.includes('end of file') || lower.includes('broken pipe');
  }
  if (e instanceof Error) {
    const lower = e.message.toLowerCase();
    return lower.includes('eof') || lower.includes('end of file') || lower.includes('broken pipe');
  }
  return false;
}
