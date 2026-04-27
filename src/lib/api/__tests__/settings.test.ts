import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/__mocks__/server';
import {
  getEnvSettings,
  getClaudeEnv,
  setEnvSettings,
  getAnthropicApiKey,
  getClaudeAuthStatus,
  setAnthropicApiKey,
  getGitHubPersonalToken,
  setGitHubPersonalToken,
  refreshAWSCredentials,
  getAWSSSOTokenStatus,
  startRelayPairing,
  cancelRelayPairing,
  getRelayStatus,
  disconnectRelay,
} from '../settings';

const API_BASE = 'http://localhost:9876';

describe('lib/api/settings', () => {
  describe('getEnvSettings', () => {
    it('unwraps envVars from response envelope', async () => {
      server.use(
        http.get(`${API_BASE}/api/settings/env`, () =>
          HttpResponse.json({ envVars: 'FOO=bar\nBAZ=qux' })
        )
      );

      const result = await getEnvSettings();
      expect(result).toBe('FOO=bar\nBAZ=qux');
    });
  });

  describe('getClaudeEnv', () => {
    it('unwraps env record from response envelope', async () => {
      server.use(
        http.get(`${API_BASE}/api/settings/claude-env`, () =>
          HttpResponse.json({ env: { FOO: 'bar', BAZ: 'qux' } })
        )
      );

      const result = await getClaudeEnv();
      expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' });
    });
  });

  describe('setEnvSettings', () => {
    it('PUTs envVars and resolves', async () => {
      let capturedBody: unknown;
      let capturedMethod = '';
      server.use(
        http.put(`${API_BASE}/api/settings/env`, async ({ request }) => {
          capturedMethod = request.method;
          capturedBody = await request.json();
          return HttpResponse.json({});
        })
      );

      await setEnvSettings('FOO=bar');
      expect(capturedMethod).toBe('PUT');
      expect(capturedBody).toEqual({ envVars: 'FOO=bar' });
    });
  });

  describe('Anthropic API key', () => {
    it('getAnthropicApiKey returns configured + maskedKey', async () => {
      server.use(
        http.get(`${API_BASE}/api/settings/anthropic-api-key`, () =>
          HttpResponse.json({ configured: true, maskedKey: 'sk-...abc' })
        )
      );

      const result = await getAnthropicApiKey();
      expect(result.configured).toBe(true);
      expect(result.maskedKey).toBe('sk-...abc');
    });

    it('setAnthropicApiKey PUTs apiKey and returns updated mask', async () => {
      let capturedBody: unknown;
      server.use(
        http.put(`${API_BASE}/api/settings/anthropic-api-key`, async ({ request }) => {
          capturedBody = await request.json();
          return HttpResponse.json({ configured: true, maskedKey: 'sk-...new' });
        })
      );

      const result = await setAnthropicApiKey('sk-real-key');
      expect(capturedBody).toEqual({ apiKey: 'sk-real-key' });
      expect(result.maskedKey).toBe('sk-...new');
    });
  });

  describe('getClaudeAuthStatus', () => {
    it('returns auth status across credential sources', async () => {
      server.use(
        http.get(`${API_BASE}/api/settings/claude-auth-status`, () =>
          HttpResponse.json({
            configured: true,
            hasStoredKey: false,
            hasEnvKey: true,
            hasCliCredentials: false,
            hasBedrock: false,
            credentialSource: 'env',
          })
        )
      );

      const status = await getClaudeAuthStatus();
      expect(status.configured).toBe(true);
      expect(status.credentialSource).toBe('env');
      expect(status.hasEnvKey).toBe(true);
    });
  });

  describe('GitHub personal token', () => {
    it('getGitHubPersonalToken returns configured + maskedToken + username', async () => {
      server.use(
        http.get(`${API_BASE}/api/settings/github-personal-token`, () =>
          HttpResponse.json({ configured: true, maskedToken: 'ghp_...xyz', username: 'alice' })
        )
      );

      const result = await getGitHubPersonalToken();
      expect(result.username).toBe('alice');
    });

    it('setGitHubPersonalToken PUTs token and returns updated info', async () => {
      let capturedBody: unknown;
      server.use(
        http.put(`${API_BASE}/api/settings/github-personal-token`, async ({ request }) => {
          capturedBody = await request.json();
          return HttpResponse.json({
            configured: true,
            maskedToken: 'ghp_...new',
            username: 'alice',
          });
        })
      );

      await setGitHubPersonalToken('ghp_real');
      expect(capturedBody).toEqual({ token: 'ghp_real' });
    });
  });

  describe('AWS SSO', () => {
    it('refreshAWSCredentials POSTs and returns status', async () => {
      let capturedMethod = '';
      server.use(
        http.post(`${API_BASE}/api/settings/aws-auth-refresh`, ({ request }) => {
          capturedMethod = request.method;
          return HttpResponse.json({ status: 'refreshed' });
        })
      );

      const result = await refreshAWSCredentials();
      expect(capturedMethod).toBe('POST');
      expect(result.status).toBe('refreshed');
    });

    it('getAWSSSOTokenStatus returns full status', async () => {
      server.use(
        http.get(`${API_BASE}/api/settings/aws-sso-token-status`, () =>
          HttpResponse.json({
            applicable: true,
            valid: true,
            expiresAt: '2026-04-26T12:00:00Z',
            expiresInMinutes: 30,
          })
        )
      );

      const status = await getAWSSSOTokenStatus();
      expect(status.applicable).toBe(true);
      expect(status.valid).toBe(true);
      expect(status.expiresInMinutes).toBe(30);
    });

    it('getAWSSSOTokenStatus handles non-applicable case', async () => {
      server.use(
        http.get(`${API_BASE}/api/settings/aws-sso-token-status`, () =>
          HttpResponse.json({ applicable: false, valid: null })
        )
      );

      const status = await getAWSSSOTokenStatus();
      expect(status.applicable).toBe(false);
      expect(status.valid).toBeNull();
    });
  });

  describe('Relay pairing', () => {
    it('startRelayPairing POSTs relayUrl and returns token + qrData', async () => {
      let capturedBody: unknown;
      server.use(
        http.post(`${API_BASE}/api/relay/pair/start`, async ({ request }) => {
          capturedBody = await request.json();
          return HttpResponse.json({ token: 'tok-1', qrData: 'data:image/...' });
        })
      );

      const result = await startRelayPairing('https://relay.example.com');
      expect(capturedBody).toEqual({ relayUrl: 'https://relay.example.com' });
      expect(result.token).toBe('tok-1');
    });

    it('cancelRelayPairing POSTs and resolves', async () => {
      let capturedMethod = '';
      server.use(
        http.post(`${API_BASE}/api/relay/pair/cancel`, ({ request }) => {
          capturedMethod = request.method;
          return HttpResponse.json({});
        })
      );

      await cancelRelayPairing();
      expect(capturedMethod).toBe('POST');
    });

    it('getRelayStatus returns connection details', async () => {
      server.use(
        http.get(`${API_BASE}/api/relay/status`, () =>
          HttpResponse.json({
            connected: true,
            paired: true,
            relayUrl: 'https://relay.example.com',
          })
        )
      );

      const status = await getRelayStatus();
      expect(status.connected).toBe(true);
      expect(status.relayUrl).toBe('https://relay.example.com');
    });

    it('disconnectRelay POSTs and resolves', async () => {
      let capturedMethod = '';
      server.use(
        http.post(`${API_BASE}/api/relay/disconnect`, ({ request }) => {
          capturedMethod = request.method;
          return HttpResponse.json({});
        })
      );

      await disconnectRelay();
      expect(capturedMethod).toBe('POST');
    });
  });
});
