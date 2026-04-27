import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/__mocks__/server';
import { checkHealth, checkHealthWithRetry } from '../health';

const API_BASE = 'http://localhost:9876';

describe('lib/api/health', () => {
  describe('checkHealth', () => {
    it('returns true on 200 OK', async () => {
      server.use(
        http.get(`${API_BASE}/health`, () => HttpResponse.json({ status: 'ok' }))
      );

      expect(await checkHealth()).toBe(true);
    });

    it('returns false on non-OK status', async () => {
      server.use(
        http.get(`${API_BASE}/health`, () =>
          HttpResponse.text('down', { status: 503 })
        )
      );

      expect(await checkHealth()).toBe(false);
    });

    it('returns false when fetch throws (network error)', async () => {
      server.use(
        http.get(`${API_BASE}/health`, () => HttpResponse.error())
      );

      expect(await checkHealth()).toBe(false);
    });
  });

  describe('checkHealthWithRetry', () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('succeeds on first attempt without delay', async () => {
      server.use(
        http.get(`${API_BASE}/health`, () => HttpResponse.json({ status: 'ok' }))
      );

      const onAttempt = vi.fn();
      const result = await checkHealthWithRetry(3, 100, onAttempt);

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(1);
      expect(onAttempt).toHaveBeenCalledTimes(1);
      expect(onAttempt).toHaveBeenCalledWith(1);
    });

    it('reports failure with attempt count after exhausting retries', async () => {
      server.use(
        http.get(`${API_BASE}/health`, () =>
          HttpResponse.text('down', { status: 503 })
        )
      );

      const onAttempt = vi.fn();
      const result = await checkHealthWithRetry(3, 1, onAttempt);

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(3);
      expect(result.error).toBe('Backend service did not respond after multiple attempts');
      expect(onAttempt).toHaveBeenCalledTimes(3);
    });

    it('recovers if a later attempt succeeds', async () => {
      let callCount = 0;
      server.use(
        http.get(`${API_BASE}/health`, () => {
          callCount++;
          if (callCount < 2) {
            return HttpResponse.text('down', { status: 503 });
          }
          return HttpResponse.json({ status: 'ok' });
        })
      );

      const result = await checkHealthWithRetry(5, 1);
      expect(result.success).toBe(true);
      expect(result.attempts).toBe(2);
    });
  });
});
