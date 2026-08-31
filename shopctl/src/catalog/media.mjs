/**
 * The images a catalogue row points at: found, judged, and named.
 *
 * Three decisions live here.
 *
 * **The declared extension is not evidence.** A row says `photo.png`; what the
 * store will serve is whatever the bytes are. The check is therefore on the
 * header bytes, and a file whose extension disagrees with its content is
 * refused rather than corrected — a `.png` that is really an SVG is the one case
 * where "helpfully" trusting the content would store a script-execution vector
 * on the store's own origin (see the ALLOWED list in features/media/upload.ts,
 * where SVG is deliberately absent for that reason).
 *
 * **The key is derived from the content, not from chance.** The admin's uploads
 * get a random key because two uploads of the same photo are two deliberate
 * acts. An import is the opposite: it runs again after a network failure, after
 * a corrected price, after nothing at all, and each run sees the same files. A
 * key that is the hash of the bytes makes the second run recognise what the
 * first one wrote — idempotence and resumption fall out of the naming rather
 * than out of a bookkeeping table that could itself be interrupted. It also
 * keeps the immutability promise `/images/*` makes: identical key, identical
 * bytes, forever.
 *
 * **Twenty hex characters, and not more.** Cloudflare's observability pipeline
 * redacts any run of 32+ hex digits in a request URL, so a full SHA-256 in the
 * key would turn every image request into `GET /images/media/REDACTED.webp`.
 * The constraint is documented at `mediaKeyFor()` in features/media/upload.ts;
 * this is the same budget spent on a prefix of the digest instead of on random
 * bytes. 80 bits over a catalogue of hundreds of files is not a collision risk.
 */
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

/** Mirrors the ALLOWED map in src/features/media/upload.ts. SVG is absent on
 *  purpose: uploads are served from the store's own origin. */
export const ALLOWED_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
]);

/** Same budget as an admin upload — one limit, or a merchant discovers two. */
export const MAX_BYTES = 5 * 1024 * 1024;

/**
 * The type the BYTES say it is, or null.
 *
 * Only the four the store accepts are recognised. Anything else — an SVG, a
 * PDF, an HTML page a browser saved with an image extension — comes back null
 * and is refused by name rather than by a fallback, so the message can say what
 * was actually found.
 */
export function sniffType(bytes) {
  const at = (offset, signature) =>
    bytes.length >= offset + signature.length && signature.every((value, index) => bytes[offset + index] === value);

  if (at(0, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (at(0, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return 'image/webp';
  return null;
}

/** What the file is called, for the message that says the two disagree. */
function extensionOf(path) {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

/** The extensions a given type may legitimately wear. */
const EXTENSIONS = new Map([
  ['image/jpeg', ['jpg', 'jpeg']],
  ['image/png', ['png']],
  ['image/webp', ['webp']],
  ['image/gif', ['gif']],
]);

/**
 * Content-addressed object key. Same bytes anywhere, same key everywhere.
 *
 * @param {Buffer|Uint8Array} bytes
 * @param {string} type one of ALLOWED_TYPES
 */
export function mediaKeyFor(bytes, type) {
  const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 20);
  return `media/${digest}.${ALLOWED_TYPES.get(type) ?? 'bin'}`;
}

/**
 * Resolve, read and judge one image referenced by the catalogue.
 *
 * Paths are relative to the CSV's own directory, and may not climb out of it: a
 * catalogue is a self-contained bundle the merchant hands over, and a row
 * reading `../../.ssh/id_rsa` is not a mistake worth being tolerant about. The
 * refusal is on the RESOLVED path, so `photos/../../secret.png` is caught too.
 *
 * @param {string} path as written in the row
 * @param {{ root: string }} options the directory the CSV sits in
 * @returns {{ ok: true, media: object }|{ ok: false, error: string, hint?: string }}
 */
export function readCatalogImage(path, { root }) {
  if (isAbsolute(path)) {
    return { ok: false, error: `« ${path} » est un chemin absolu.`, hint: 'Les images se désignent relativement au CSV, pour que le dossier reste transportable.' };
  }
  const full = resolve(root, path);
  const inside = relative(root, full);
  if (inside.startsWith('..')) {
    return { ok: false, error: `« ${path} » sort du dossier du catalogue.`, hint: 'Un catalogue est un dossier autonome : déplacez l\'image à l\'intérieur.' };
  }

  let stats;
  try {
    stats = statSync(full);
  } catch {
    return { ok: false, error: `image introuvable : « ${path} ».`, hint: `Cherchée dans ${root}.` };
  }
  if (!stats.isFile()) return { ok: false, error: `« ${path} » n'est pas un fichier.` };
  if (stats.size === 0) return { ok: false, error: `« ${path} » est vide.` };
  if (stats.size > MAX_BYTES) {
    const megabytes = (stats.size / (1024 * 1024)).toFixed(1);
    return {
      ok: false,
      error: `« ${path} » pèse ${megabytes} Mo ; la limite est de ${MAX_BYTES / (1024 * 1024)} Mo.`,
      hint: 'Même limite que le téléversement depuis l\'administration : deux limites différentes pour un même magasin est une surprise garantie.',
    };
  }

  const bytes = readFileSync(full);
  const type = sniffType(bytes);
  if (!type) {
    return {
      ok: false,
      error: `« ${path} » n'est pas une image JPEG, PNG, WebP ou GIF.`,
      hint: 'Le type est lu dans les octets, pas dans l\'extension. Le SVG est refusé : il s\'exécuterait sur le domaine de la boutique.',
    };
  }
  const extension = extensionOf(path);
  if (extension && !(EXTENSIONS.get(type) ?? []).includes(extension)) {
    return {
      ok: false,
      error: `« ${path} » s'annonce en .${extension} et contient du ${type}.`,
      hint: 'Renommez le fichier d\'après son contenu réel. L\'import ne corrige pas l\'écart de lui-même : un fichier dont le nom ment sur le contenu est le cas où deviner est le plus coûteux.',
    };
  }

  return {
    ok: true,
    media: {
      path,
      absolutePath: full,
      key: mediaKeyFor(bytes, type),
      mime_type: type,
      size_bytes: stats.size,
      original_name: path.slice(path.lastIndexOf('/') + 1),
      dimensions: readImageDimensions(bytes),
    },
  };
}

/**
 * Resolve every image the catalogue references, once per distinct path.
 *
 * Kept separate from the planner so the planner stays pure: it compares two
 * descriptions of a catalogue and never touches a disk. This is the only place
 * that reads image bytes, and it reads each file once however many products
 * point at it — a photo shared by ten rows is one hash, not ten.
 *
 * @param {object[]} products from buildCatalogue
 * @param {{ root: string }} options directory the CSV sits in
 * @returns {{ products: object[], issues: object[] }} products carrying `media`
 */
export function resolveCatalogueImages(products, { root }) {
  const cache = new Map();
  const issues = [];
  const resolved = [];

  for (const product of products) {
    const media = [];
    let failed = false;
    for (const image of product.images) {
      if (!cache.has(image.path)) cache.set(image.path, readCatalogImage(image.path, { root }));
      const result = cache.get(image.path);
      if (!result.ok) {
        issues.push({ line: image.line, column: 'images', message: result.error, hint: result.hint ?? null });
        failed = true;
        continue;
      }
      media.push(result.media);
    }
    // A product whose images cannot be read is not importable "without its
    // photos": the gallery is part of what the row describes, and importing the
    // text alone would look like a success and read as a broken page.
    if (failed) continue;
    resolved.push({ ...product, media });
  }

  return { products: resolved, issues };
}

/**
 * Pixel dimensions from the header bytes.
 *
 * A second copy of `src/features/media/dimensions.ts`, for the same reason as
 * slugify(): that one is TypeScript inside the Worker bundle, this one runs in a
 * CLI with no build step. Both are pinned against each other over a corpus of
 * generated images in test/scripts/catalog.test.mjs. Tolerant by design —
 * anything unrecognised returns null, because a missing dimension costs a layout
 * shift where a thrown error would cost the import.
 */
export function readImageDimensions(bytes) {
  return png(bytes) ?? gif(bytes) ?? webp(bytes) ?? jpeg(bytes);
}

const u16be = (b, i) => (b[i] << 8) | b[i + 1];
const u32be = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const u16le = (b, i) => b[i] | (b[i + 1] << 8);
const u24le = (b, i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const matches = (b, offset, signature) =>
  b.length >= offset + signature.length && signature.every((value, index) => b[offset + index] === value);

function png(b) {
  if (!matches(b, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return null;
  if (b.length < 24) return null;
  return valid(u32be(b, 16), u32be(b, 20));
}

function gif(b) {
  if (!matches(b, 0, [0x47, 0x49, 0x46])) return null;
  if (b.length < 10) return null;
  return valid(u16le(b, 6), u16le(b, 8));
}

function webp(b) {
  if (!matches(b, 0, [0x52, 0x49, 0x46, 0x46]) || !matches(b, 8, [0x57, 0x45, 0x42, 0x50])) return null;
  const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);

  if (chunk === 'VP8 ' && b.length >= 30) {
    if (!matches(b, 23, [0x9d, 0x01, 0x2a])) return null;
    return valid(u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff);
  }
  if (chunk === 'VP8L' && b.length >= 25) {
    if (b[20] !== 0x2f) return null;
    const bits = u32be(b, 21);
    const packed = ((bits >>> 24) & 0xff) | (((bits >>> 16) & 0xff) << 8) |
      (((bits >>> 8) & 0xff) << 16) | ((bits & 0xff) << 24);
    return valid((packed & 0x3fff) + 1, ((packed >>> 14) & 0x3fff) + 1);
  }
  if (chunk === 'VP8X' && b.length >= 30) {
    return valid(u24le(b, 24) + 1, u24le(b, 27) + 1);
  }
  return null;
}

function jpeg(b) {
  if (!matches(b, 0, [0xff, 0xd8])) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = b[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = u16be(b, i + 2);
    if (length < 2) return null;
    const isFrameHeader = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrameHeader) {
      if (i + 9 >= b.length) return null;
      return valid(u16be(b, i + 7), u16be(b, i + 5));
    }
    i += 2 + length;
  }
  return null;
}

function valid(width, height) {
  const sane = (n) => Number.isInteger(n) && n > 0 && n <= 65535;
  return sane(width) && sane(height) ? { width, height } : null;
}

/**
 * The delivery budget an imported image is judged against.
 *
 * NOT a resize. Nothing in a dependency-free CLI can re-encode a JPEG, and the
 * store does not need it to: `features/products/image.ts` already serves every
 * catalogue image through `fit=scale-down,format=auto` at four widths, so an
 * oversized original costs storage and the first transform, not bandwidth on
 * every page view. What the import owes the merchant is therefore the WARNING —
 * this photo is far larger than anything the store will ever serve — rather than
 * a silent re-encode that would change the bytes their key was derived from.
 */
export const DELIVERY_MAX_WIDTH = 2048;

export function oversizedForDelivery(media) {
  return Boolean(media.dimensions && media.dimensions.width > DELIVERY_MAX_WIDTH);
}
