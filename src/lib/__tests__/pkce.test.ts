import { describe, it, expect } from 'vitest';
import { generateRandomString, generateCodeChallenge } from '../pkce';

describe('generateRandomString', () => {
  it('returns a hex string of the correct length', () => {
    // 32 bytes = 64 hex characters
    const result = generateRandomString(32);
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]+$/);
  });

  it('returns different values on subsequent calls', () => {
    const a = generateRandomString(16);
    const b = generateRandomString(16);
    expect(a).not.toBe(b);
  });

  it('handles length of 1', () => {
    const result = generateRandomString(1);
    expect(result).toHaveLength(2); // 1 byte = 2 hex chars
    expect(result).toMatch(/^[0-9a-f]{2}$/);
  });

  it('handles length of 0', () => {
    const result = generateRandomString(0);
    expect(result).toBe('');
  });
});

describe('generateCodeChallenge', () => {
  it('returns a base64url-encoded string without padding', async () => {
    const challenge = await generateCodeChallenge('test-verifier');
    // Base64url: only [A-Za-z0-9_-], no + / =
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('produces deterministic output for the same input', async () => {
    const a = await generateCodeChallenge('same-verifier');
    const b = await generateCodeChallenge('same-verifier');
    expect(a).toBe(b);
  });

  it('produces different output for different inputs', async () => {
    const a = await generateCodeChallenge('verifier-one');
    const b = await generateCodeChallenge('verifier-two');
    expect(a).not.toBe(b);
  });

  it('produces a known SHA-256 challenge for a known verifier', async () => {
    // SHA-256("hello") = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
    // Converted to base64url (no padding)
    const challenge = await generateCodeChallenge('hello');
    expect(challenge).toBe('LPJNul-wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ');
  });

  it('handles empty string verifier', async () => {
    const challenge = await generateCodeChallenge('');
    // SHA-256 of empty string is a well-known value
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge.length).toBeGreaterThan(0);
  });
});
