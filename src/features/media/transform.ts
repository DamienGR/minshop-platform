/**
 * The one transformation a photo goes through on its way to lighter: at upload
 * when « Optimiser les images à l’import » is on (`optimizeUpload()`), and later
 * from Médias for a photo already stored (`optimizeStoredMedia()`, ticket #255).
 * One function so the two cannot drift: a photo optimized today and one
 * optimized at upload are the same file.
 *
 * Width only, as the upload always did: the binding's default fit is
 * `scale-down`, so a photo narrower than `maxWidth` keeps its size and is only
 * re-encoded. No `cloudflare:workers` import: the binding is passed in, which is
 * what lets test/integration/media-optimize.mjs run the real call against
 * miniflare's offline Images binding.
 */

export const OPTIMIZED_TYPE = 'image/webp';
export const OPTIMIZED_QUALITY = 82;

/** The optimized bytes, or null when the binding answered with nothing. */
export async function transformForStorage(
  images: ImagesBindingMin,
  input: ReadableStream,
  maxWidth: number,
): Promise<ArrayBuffer | null> {
  const out = await images
    .input(input)
    .transform({ width: maxWidth })
    .output({ format: OPTIMIZED_TYPE, quality: OPTIMIZED_QUALITY });
  const buffer = await out.response().arrayBuffer();
  return buffer.byteLength === 0 ? null : buffer;
}
