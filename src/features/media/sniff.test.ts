import { describe, it, expect } from 'vitest';
import { sniffImageMime } from './sniff';

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string) => new TextEncoder().encode(text);

describe('sniffImageMime', () => {
  it('recognizes every type the library accepts', () => {
    expect(sniffImageMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0))).toBe(
      'image/png',
    );
    expect(sniffImageMime(ascii('GIF89a......'))).toBe('image/gif');
    expect(sniffImageMime(ascii('GIF87a......'))).toBe('image/gif');
    expect(sniffImageMime(ascii('RIFF____WEBPVP8 '))).toBe('image/webp');
    expect(sniffImageMime(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0))).toBe('image/jpeg');
    // Raw JPEG: no APPn segment, straight to the quantization table.
    expect(sniffImageMime(bytes(0xff, 0xd8, 0xff, 0xdb, 0, 0))).toBe('image/jpeg');
  });

  it('refuses an SVG whatever it is called', () => {
    expect(sniffImageMime(ascii('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(sniffImageMime(ascii('<?xml version="1.0"?><svg/>'))).toBeNull();
  });

  it('refuses HTML, a PDF and an empty file', () => {
    expect(sniffImageMime(ascii('<!doctype html><script>alert(1)</script>'))).toBeNull();
    expect(sniffImageMime(ascii('%PDF-1.7'))).toBeNull();
    expect(sniffImageMime(bytes())).toBeNull();
  });

  it('refuses a truncated signature rather than guessing', () => {
    expect(sniffImageMime(bytes(0x89, 0x50, 0x4e))).toBeNull();
    expect(sniffImageMime(ascii('RIFF____WAVE'))).toBeNull();
  });
});
