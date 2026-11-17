import { describe, it, expect } from 'vitest';
import {
  HEAVY_BYTES,
  emptyTally,
  isOptimizable,
  optimizeResultHref,
  readCursor,
  readTally,
  tally,
  tallyParams,
  type OptimizableFields,
} from './optimize';

// The rule against real rows, and the move itself, are in
// test/integration/media-optimize.mjs (D1 and the Images binding).

const photo = (partial: Partial<OptimizableFields> = {}): OptimizableFields => ({
  image_key: 'media/0123456789abcdef0123.jpg',
  mime_type: 'image/jpeg',
  size_bytes: 2 * 1024 * 1024,
  width: 4000,
  optimized_at: null,
  ...partial,
});

describe('isOptimizable', () => {
  it('offers a photo wider than the store shows, or heavier than 500 Ko', () => {
    expect(isOptimizable(photo(), 1000)).toBe(true);
    expect(isOptimizable(photo({ size_bytes: 1000, width: 1001 }), 1000)).toBe(true);
    expect(isOptimizable(photo({ size_bytes: HEAVY_BYTES + 1, width: 800 }), 1000)).toBe(true);
    // Width unknown (a row older than migration 0029): the weight decides.
    expect(isOptimizable(photo({ width: null }), 1000)).toBe(true);
  });

  it('leaves a photo already as light as an upload makes it', () => {
    expect(isOptimizable(photo({ size_bytes: HEAVY_BYTES, width: 1000 }), 1000)).toBe(false);
    expect(isOptimizable(photo({ size_bytes: 1000, width: null }), 1000)).toBe(false);
  });

  it('follows the store’s own width', () => {
    expect(isOptimizable(photo({ size_bytes: 1000, width: 1200 }), 1600)).toBe(false);
    expect(isOptimizable(photo({ size_bytes: 1000, width: 1200 }), 800)).toBe(true);
  });

  it('never offers a photo twice, a GIF, an old image or a key outside media/', () => {
    expect(isOptimizable(photo({ optimized_at: '2026-11-17 21:00:00' }), 1000)).toBe(false);
    expect(isOptimizable(photo({ mime_type: 'image/gif' }), 1000)).toBe(false);
    expect(isOptimizable(photo({ mime_type: null }), 1000)).toBe(false);
    expect(isOptimizable(photo({ size_bytes: null }), 1000)).toBe(false);
    expect(isOptimizable(photo({ image_key: 'products/0123456789abcdef0123.jpg' }), 1000)).toBe(false);
  });

  it('takes the three formats a photo can be re-encoded from', () => {
    for (const mime_type of ['image/jpeg', 'image/png', 'image/webp']) {
      expect(isOptimizable(photo({ mime_type }), 1000)).toBe(true);
    }
  });
});

describe('the tally a pass carries', () => {
  it('adds each result where Médias reports it, a skipped photo nowhere', () => {
    let total = emptyTally();
    total = tally(total, { status: 'optimized', oldKey: 'media/a.jpg', newKey: 'media/b.webp', before: 3000, after: 400 });
    total = tally(total, { status: 'optimized', oldKey: 'media/c.jpg', newKey: 'media/d.webp', before: 2000, after: 100 });
    total = tally(total, { status: 'kept', before: 600 });
    total = tally(total, { status: 'failed', reason: 'transform' });
    total = tally(total, { status: 'skipped' });
    expect(total).toEqual({ optimized: 2, kept: 1, failed: 1, bytesBefore: 5000, bytesAfter: 500 });
  });

  it('survives the round trip through a query string', () => {
    const total = { optimized: 3, kept: 1, failed: 2, bytesBefore: 7_340_032, bytesAfter: 524_288 };
    const params = new URLSearchParams(tallyParams(total));
    expect(readTally((name) => params.get(name))).toEqual(total);
  });

  it('counts what it cannot read as zero', () => {
    const params = new URLSearchParams('optimized=-2&kept=1.5&failed=abc&bytesBefore=1e400');
    expect(readTally((name) => params.get(name))).toEqual(emptyTally());
  });
});

describe('optimizeResultHref', () => {
  const total = { optimized: 2, kept: 0, failed: 1, bytesBefore: 5000, bytesAfter: 500 };

  it('carries the cursor and what is left while a pass runs', () => {
    const href = optimizeResultHref({ state: 'running', total, after: 42, remaining: 7 });
    const url = new URL(href, 'https://shop.example');
    expect(url.pathname).toBe('/admin/media');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      optimize: 'running',
      optimized: '2',
      kept: '0',
      failed: '1',
      bytesBefore: '5000',
      bytesAfter: '500',
      after: '42',
      remaining: '7',
    });
  });

  it('drops the cursor once done, and goes back to the grid’s page', () => {
    const url = new URL(optimizeResultHref({ state: 'done', total, after: 42, remaining: 0, page: 3 }), 'https://shop.example');
    expect(url.searchParams.get('optimize')).toBe('done');
    expect(url.searchParams.has('after')).toBe(false);
    expect(url.searchParams.has('remaining')).toBe(false);
    expect(url.searchParams.get('page')).toBe('3');
    expect(new URL(optimizeResultHref({ state: 'done', total, page: 1 }), 'https://shop.example').searchParams.has('page')).toBe(false);
  });
});

describe('readCursor', () => {
  it('reads a positive integer and nothing else', () => {
    expect(readCursor('42')).toBe(42);
    for (const value of [null, undefined, '', '0', '-3', '2.5', 'abc', '1e400', 42]) {
      expect(readCursor(value)).toBe(0);
    }
  });
});
