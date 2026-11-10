import { describe, expect, it } from 'vitest';
import {
  ADMIN_TOKEN_SESSION_SECONDS,
  ADMIN_TOKEN_TTL_SECONDS,
  adminTokenDigest,
  generateAdminToken,
  normalizeAdminToken,
} from './adminToken';

describe('generateAdminToken', () => {
  it('draws 43 base64url characters, a new one each time', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateAdminToken()));
    expect(tokens.size).toBe(50);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('is a token its own form accepts', () => {
    const token = generateAdminToken();
    expect(normalizeAdminToken(token)).toBe(token);
  });
});

describe('normalizeAdminToken', () => {
  // Copied from a terminal, a token often comes with the line break after it.
  it('forgives the spaces and line breaks of a paste, nothing else', () => {
    const token = generateAdminToken();
    expect(normalizeAdminToken(`  ${token}\n`)).toBe(token);
    expect(normalizeAdminToken(`${token.slice(0, 20)} ${token.slice(20)}`)).toBeNull();
  });

  it('refuses what cannot be a token before anything is looked up', () => {
    const token = generateAdminToken();
    for (const value of [null, undefined, '', token.slice(1), `${token}A`, `${token.slice(1)}=`, `${token.slice(1)}+`]) {
      expect(normalizeAdminToken(value)).toBeNull();
    }
  });
});

describe('adminTokenDigest', () => {
  it('is the hex SHA-256 of the token, so the database never holds the token', async () => {
    // SHA-256("abc"), the FIPS 180-2 test vector.
    expect(await adminTokenDigest('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const token = generateAdminToken();
    const digest = await adminTokenDigest(token);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toContain(token);
    expect(await adminTokenDigest(token)).toBe(digest);
  });
});

describe('durations', () => {
  // The two durations Damien chose for ticket #227: a token that waits a
  // quarter of an hour, a session that lasts a working day, not the login's week.
  it('gives a token fifteen minutes and its session eight hours', () => {
    expect(ADMIN_TOKEN_TTL_SECONDS).toBe(15 * 60);
    expect(ADMIN_TOKEN_SESSION_SECONDS).toBe(8 * 3600);
  });
});
