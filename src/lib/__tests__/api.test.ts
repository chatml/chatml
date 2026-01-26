import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { handlers } from '../../__mocks__/handlers';
import { listSessions, updateSession } from '../api';

// Setup MSW server
const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

describe('Session API', () => {
  describe('listSessions', () => {
    it('should exclude archived sessions by default', async () => {
      const sessions = await listSessions('workspace-1');
      expect(sessions).toHaveLength(1);
      expect(sessions.every(s => !s.archived)).toBe(true);
      expect(sessions[0].id).toBe('session-1');
    });

    it('should include archived sessions when requested', async () => {
      const sessions = await listSessions('workspace-1', true);
      expect(sessions).toHaveLength(2);
      expect(sessions.some(s => s.archived)).toBe(true);
    });
  });

  describe('updateSession', () => {
    it('should archive a session', async () => {
      const result = await updateSession('workspace-1', 'session-1', { archived: true });
      expect(result.archived).toBe(true);
    });

    it('should unarchive a session', async () => {
      // First archive it
      await updateSession('workspace-1', 'session-1', { archived: true });
      // Then unarchive
      const result = await updateSession('workspace-1', 'session-1', { archived: false });
      expect(result.archived).toBe(false);
    });

    it('should pin a session', async () => {
      const result = await updateSession('workspace-1', 'session-1', { pinned: true });
      expect(result.pinned).toBe(true);
    });

    it('should unpin a session', async () => {
      // First pin it
      await updateSession('workspace-1', 'session-1', { pinned: true });
      // Then unpin
      const result = await updateSession('workspace-1', 'session-1', { pinned: false });
      expect(result.pinned).toBe(false);
    });

    it('should update both archived and pinned in one request', async () => {
      const result = await updateSession('workspace-1', 'session-1', {
        archived: true,
        pinned: true,
      });
      expect(result.archived).toBe(true);
      expect(result.pinned).toBe(true);
    });
  });
});
