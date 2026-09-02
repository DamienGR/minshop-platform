/**
 * One real, decodable file per format the media library accepts, plus the
 * payloads it must refuse.
 *
 * Uploads are validated against the bytes now (features/media/sniff.ts), so a
 * test that builds `new File([new Uint8Array(1024)], …, { type: 'image/png' })`
 * is testing a file that is not a PNG — it would have proved the old, weaker
 * rule and failed the new one for the wrong reason. These are the smallest
 * genuine files of each type: one pixel each, header and all.
 *
 * Shared by the unit suites beside the code and by the security gate, so the
 * bytes a route accepts in one and refuses in the other are the same bytes.
 */

const decode = (base64) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

/** 1x1 opaque PNG. */
export const PNG_1X1 = decode(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
);

/** 1x1 GIF89a. */
export const GIF_1X1 = decode('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7');

/** 1x1 lossy WebP. */
export const WEBP_1X1 = decode(
  'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA',
);

/** 1x1 baseline JPEG. */
export const JPEG_1X1 = decode(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
    'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
    'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
);

/** The four accepted formats, by their true MIME type. */
export const REAL_IMAGES = {
  'image/png': PNG_1X1,
  'image/gif': GIF_1X1,
  'image/webp': WEBP_1X1,
  'image/jpeg': JPEG_1X1,
};

/** An SVG carrying script — the format the library refuses outright. */
export const SVG_WITH_SCRIPT = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1">' +
    '<script>document.location=String.fromCharCode(47)</script></svg>',
);

/** A page of HTML, for the upload that claims to be an image and is not. */
export const HTML_PAGE = new TextEncoder().encode(
  '<!doctype html><title>not an image</title><script>alert(1)</script>',
);

/**
 * A File whose declared type may deliberately disagree with its bytes.
 *
 * @param {Uint8Array} bytes
 * @param {{ type: string, name?: string }} options
 * @returns {File}
 */
export function fileOf(bytes, options) {
  return new File([bytes], options.name ?? 'upload', { type: options.type });
}
