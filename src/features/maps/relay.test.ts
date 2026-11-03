import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_TILE_TTL,
  MAX_TILE_BYTES,
  relayTile,
  relayUserAgent,
  tileCacheControl,
} from './relay';

const TILE = { z: 16, x: 32265, y: 22873 };
const ORIGIN = 'https://boutique.example';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A tile server that answers `response`, and remembers what it was asked. */
function server(response: () => Response) {
  const calls: Request[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(new Request(input, init));
    return response();
  }) as typeof globalThis.fetch;
  return { calls, fetch };
}

const relay = (fetch: typeof globalThis.fetch) =>
  relayTile(TILE, { fetch, tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', origin: ORIGIN });

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

describe('relayTile', () => {
  it('asks the server for the tile, naming the shop as OpenStreetMap’s policy asks', async () => {
    const { calls, fetch } = server(() => new Response(PNG, { headers: { 'content-type': 'image/png' } }));
    await relay(fetch);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://tile.openstreetmap.org/16/32265/22873.png');
    expect(calls[0].headers.get('user-agent')).toBe(relayUserAgent(ORIGIN));
    expect(calls[0].headers.get('user-agent')).toContain(ORIGIN);
    expect(calls[0].headers.get('referer')).toBe(`${ORIGIN}/`);
  });

  it('calls fetch detached: workerd refuses its fetch on any other receiver', async () => {
    let receiver: unknown = 'unset';
    const fetch = function (this: unknown) {
      receiver = this;
      return Promise.resolve(new Response(PNG, { headers: { 'content-type': 'image/png' } }));
    } as unknown as typeof globalThis.fetch;
    await relay(fetch);
    expect(receiver).toBeUndefined();
  });

  it('never asks the server not to cache', async () => {
    const { calls, fetch } = server(() => new Response(PNG, { headers: { 'content-type': 'image/png' } }));
    await relay(fetch);
    expect(calls[0].headers.get('cache-control')).toBeNull();
    expect(calls[0].headers.get('pragma')).toBeNull();
  });

  it('hands the tile on with the server’s freshness and validators', async () => {
    const { fetch } = server(
      () =>
        new Response(PNG, {
          headers: {
            'content-type': 'image/png',
            'cache-control': 'max-age=86400, stale-while-revalidate=604800',
            etag: '"abc"',
            'last-modified': 'Mon, 02 Nov 2026 10:00:00 GMT',
            'set-cookie': 'tracker=1',
          },
        }),
    );
    const response = await relay(fetch);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toBe('public, max-age=86400');
    expect(response.headers.get('etag')).toBe('"abc"');
    expect(response.headers.get('last-modified')).toBe('Mon, 02 Nov 2026 10:00:00 GMT');
    // Only the headers chosen here leave: nothing the server set on its own.
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
  });

  it.each([
    ['answers an error', () => new Response('busy', { status: 503 })],
    ['answers something other than an image', () => new Response('<html>', { headers: { 'content-type': 'text/html' } })],
    ['answers an SVG, which can carry script', () => new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } })],
    [
      'announces more than a tile weighs',
      () => new Response(PNG, { headers: { 'content-type': 'image/png', 'content-length': String(MAX_TILE_BYTES + 1) } }),
    ],
    [
      'sends more than a tile weighs',
      () => new Response(new Uint8Array(MAX_TILE_BYTES + 1), { headers: { 'content-type': 'image/png' } }),
    ],
  ])('answers 502, never cached, when the server %s', async (_label, answer) => {
    const { fetch } = server(answer);
    const response = await relay(fetch);
    expect(response.status).toBe(502);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('answers 502 when the server cannot be reached, and logs no address', async () => {
    const fetch = (async () => {
      throw new TypeError('fetch failed: https://tile.openstreetmap.org/16/32265/22873.png');
    }) as typeof globalThis.fetch;
    const response = await relay(fetch);
    expect(response.status).toBe(502);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = JSON.parse(String(warn.mock.calls[0][0]));
    expect(line).toEqual({ event: 'map_tile_unavailable', reason: 'unreachable' });
  });
});

describe('tileCacheControl', () => {
  const headers = (init: Record<string, string>) => new Headers(init);

  it('takes the server’s max-age, or its s-maxage first', () => {
    expect(tileCacheControl(headers({ 'cache-control': 'max-age=3600' }))).toBe('public, max-age=3600');
    expect(tileCacheControl(headers({ 'cache-control': 'max-age=60, s-maxage=7200' }))).toBe(
      'public, max-age=7200',
    );
  });

  it('reads Expires against Date when there is no max-age', () => {
    expect(
      tileCacheControl(
        headers({ date: 'Tue, 03 Nov 2026 10:00:00 GMT', expires: 'Wed, 04 Nov 2026 10:00:00 GMT' }),
      ),
    ).toBe('public, max-age=86400');
  });

  it('falls back to the policy’s seven days when nothing is readable', () => {
    expect(tileCacheControl(headers({}))).toBe(`public, max-age=${DEFAULT_TILE_TTL}`);
    expect(DEFAULT_TILE_TTL).toBe(604800);
  });

  it('stores nothing when the server says not to', () => {
    expect(tileCacheControl(headers({ 'cache-control': 'no-store' }))).toBe('no-store');
    expect(tileCacheControl(headers({ 'cache-control': 'private, max-age=600' }))).toBe('no-store');
    expect(tileCacheControl(headers({ 'cache-control': 'max-age=0' }))).toBe('no-store');
  });

  it('caps an absurd freshness at a year', () => {
    expect(tileCacheControl(headers({ 'cache-control': 'max-age=999999999' }))).toBe(
      'public, max-age=31536000',
    );
  });
});
