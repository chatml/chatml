import { describe, it, expect, vi, afterEach } from 'vitest';
import { http, HttpResponse, delay } from 'msw';
import { server } from '@/__mocks__/server';
import { fetchWithAuth } from '../base';

const API_BASE = 'http://localhost:9876';

describe('fetchWithAuth in-flight GET dedup', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('collapses concurrent identical GETs into a single underlying request', async () => {
    let calls = 0;
    server.use(
      http.get(`${API_BASE}/api/dedup-test`, async () => {
        calls += 1;
        await delay(20);
        return HttpResponse.json({ value: 'ok', call: calls });
      })
    );

    const responses = await Promise.all(
      Array.from({ length: 8 }, () => fetchWithAuth(`${API_BASE}/api/dedup-test`))
    );
    const bodies = await Promise.all(responses.map((r) => r.json()));

    expect(calls).toBe(1);
    for (const body of bodies) {
      expect(body).toEqual({ value: 'ok', call: 1 });
    }
  });

  it('re-issues a fresh request after the previous call settles', async () => {
    let calls = 0;
    server.use(
      http.get(`${API_BASE}/api/dedup-fresh`, () => {
        calls += 1;
        return HttpResponse.json({ call: calls });
      })
    );

    const r1 = await fetchWithAuth(`${API_BASE}/api/dedup-fresh`);
    await r1.json();
    const r2 = await fetchWithAuth(`${API_BASE}/api/dedup-fresh`);
    await r2.json();

    expect(calls).toBe(2);
  });

  it('does not dedup non-GET requests', async () => {
    let calls = 0;
    server.use(
      http.post(`${API_BASE}/api/dedup-post`, async () => {
        calls += 1;
        await delay(20);
        return HttpResponse.json({ ok: true });
      })
    );

    await Promise.all(
      Array.from({ length: 4 }, () =>
        fetchWithAuth(`${API_BASE}/api/dedup-post`, { method: 'POST' })
      )
    );

    expect(calls).toBe(4);
  });

  it('serial GETs to the same URL across tests get fresh data', async () => {
    server.use(
      http.get(`${API_BASE}/api/dedup-serial`, () => HttpResponse.json({ batch: 'first' }))
    );
    const r1 = await fetchWithAuth(`${API_BASE}/api/dedup-serial`);
    expect(await r1.json()).toEqual({ batch: 'first' });

    // Replace handler — second call should return the new data, not cached.
    server.use(
      http.get(`${API_BASE}/api/dedup-serial`, () => HttpResponse.json({ batch: 'second' }))
    );
    const r2 = await fetchWithAuth(`${API_BASE}/api/dedup-serial`);
    expect(await r2.json()).toEqual({ batch: 'second' });
  });

  it('aborting one waiter does not cancel the shared fetch for others', async () => {
    let calls = 0;
    server.use(
      http.get(`${API_BASE}/api/dedup-abort`, async () => {
        calls += 1;
        await delay(30);
        return HttpResponse.json({ ok: true });
      })
    );

    const ctrl = new AbortController();
    const aborted = fetchWithAuth(`${API_BASE}/api/dedup-abort`, { signal: ctrl.signal });
    const survives = fetchWithAuth(`${API_BASE}/api/dedup-abort`);
    ctrl.abort();

    await expect(aborted).rejects.toThrow();

    const r = await survives;
    const body = await r.json();
    expect(calls).toBe(1);
    expect(body).toEqual({ ok: true });
  });
});
