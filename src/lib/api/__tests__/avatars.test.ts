import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/__mocks__/server';
import { getAvatars } from '../avatars';

const API_BASE = 'http://localhost:9876';

describe('lib/api/avatars', () => {
  describe('getAvatars', () => {
    it('returns empty object without hitting backend when emails is empty', async () => {
      let calledBackend = false;
      server.use(
        http.get(`${API_BASE}/api/avatars`, () => {
          calledBackend = true;
          return HttpResponse.json({ avatars: {} });
        })
      );

      const result = await getAvatars([]);
      expect(result).toEqual({});
      expect(calledBackend).toBe(false);
    });

    it('joins emails with comma and unwraps the avatars field from response', async () => {
      let capturedSearch = '';
      server.use(
        http.get(`${API_BASE}/api/avatars`, ({ request }) => {
          capturedSearch = new URL(request.url).search;
          return HttpResponse.json({
            avatars: {
              'alice@example.com': 'https://avatars/alice',
              'bob@example.com': 'https://avatars/bob',
            },
          });
        })
      );

      const result = await getAvatars(['alice@example.com', 'bob@example.com']);

      const params = new URLSearchParams(capturedSearch);
      expect(params.get('emails')).toBe('alice@example.com,bob@example.com');
      expect(result).toEqual({
        'alice@example.com': 'https://avatars/alice',
        'bob@example.com': 'https://avatars/bob',
      });
    });

    it('handles single-email request', async () => {
      let capturedSearch = '';
      server.use(
        http.get(`${API_BASE}/api/avatars`, ({ request }) => {
          capturedSearch = new URL(request.url).search;
          return HttpResponse.json({
            avatars: { 'alice@example.com': 'https://avatars/alice' },
          });
        })
      );

      const result = await getAvatars(['alice@example.com']);
      expect(new URLSearchParams(capturedSearch).get('emails')).toBe('alice@example.com');
      expect(result['alice@example.com']).toBe('https://avatars/alice');
    });
  });
});
