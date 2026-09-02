/**
 * What a file actually is, read from its first bytes.
 *
 * The upload rules were written against `File.type`, which is not a fact about
 * the file: it is a string the client sent, chosen by whatever posted the
 * multipart body. `curl -F 'files=@payload.svg;type=image/png'` sets it to
 * anything, and so does a page of JavaScript. So the store's answer to "is this
 * a PNG" came from the same place as the file did.
 *
 * Nothing is executed from an uploaded object today — the library refuses SVG
 * by MIME type, /images serves back exactly what R2 stored, and
 * `x-content-type-options: nosniff` on every response stops a browser
 * reinterpreting it — so a file lying about its type has not been a way in. It
 * is still a file the store believes something false about: the library lists
 * it as an image, the product page embeds it, and anything added on top of
 * either inherits the lie. The declared type costs four byte comparisons to
 * check, so it is checked.
 *
 * Only the four types the library accepts are recognized. This verifies a
 * declared type; it is not a general file-type oracle. Everything else answers
 * null, and null is a refusal.
 */

/** Enough for the longest signature below (WebP's, at twelve bytes). */
export const SNIFF_BYTES = 16;

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0): boolean =>
  bytes.length >= offset + signature.length &&
  signature.every((value, index) => bytes[offset + index] === value);

/**
 * The MIME type these bytes really carry, or null when they carry none the
 * media library accepts.
 */
export function sniffImageMime(bytes: Uint8Array): string | null {
  // PNG: the eight-byte signature, whose non-ASCII bytes also catch a file that
  // has been through a text-mangling transport.
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  // GIF87a / GIF89a.
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  // RIFF, a four-byte size, then WEBP.
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return 'image/webp';
  }
  // JPEG: start-of-image followed by any marker. Every variant (JFIF, Exif,
  // raw) opens FF D8 FF; the third byte says which, and none of them matter
  // here.
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  return null;
}
