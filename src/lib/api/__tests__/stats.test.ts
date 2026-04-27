import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/__mocks__/server';
import { getSpendStats } from '../stats';
import type { SpendStats } from '@/lib/types';

const API_BASE = 'http://localhost:9876';

const mockStats = {
  totalSpend: 12.34,
  byModel: { 'claude-sonnet-4-6': 10.0, 'claude-haiku-4-5': 2.34 },
  byDay: [{ date: '2026-04-25', amount: 5.0 }],
} as unknown as SpendStats;

describe('lib/api/stats', () => {
  describe('getSpendStats', () => {
    it('returns spend stats with no day filter (no query string)', async () => {
      let capturedUrl = '';
      server.use(
        http.get(`${API_BASE}/api/stats/spend`, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json(mockStats);
        })
      );

      const stats = await getSpendStats();
      expect(stats).toEqual(mockStats);
      expect(capturedUrl).toBe(`${API_BASE}/api/stats/spend`);
    });

    it('appends ?days when provided', async () => {
      let capturedSearch = '';
      server.use(
        http.get(`${API_BASE}/api/stats/spend`, ({ request }) => {
          capturedSearch = new URL(request.url).search;
          return HttpResponse.json(mockStats);
        })
      );

      await getSpendStats(7);
      expect(new URLSearchParams(capturedSearch).get('days')).toBe('7');
    });
  });
});
