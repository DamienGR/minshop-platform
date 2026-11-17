-- Migration 0063: a photo optimized after it was stored (ticket #255).
--
-- « Optimiser » in Admin → Médias passes a photo already in the bucket through
-- the transformation an upload gets (images.maxWidth, WebP 82) and stores the
-- result under a NEW key: `/images/*` is served immutable and the backups'
-- media pool seals an object once per key (ADR 0019), so a key never changes
-- its bytes. Every reference moves to the new key in one guarded batch
-- (src/features/media/optimize.ts).
--
-- source_key: the key the photo had BEFORE its first optimization. The
-- catalogue importer names a photo by the hash of its bytes; without this
-- column a re-import of the same CSV would no longer recognise an optimized
-- photo, send the heavy original again and rebuild the gallery, clearing the
-- photo of every variant. Kept through a second optimization (COALESCE), and
-- unique, so a key the CSV wants resolves to one media row at most.
--
-- optimized_at: when « Optimiser » last processed the row, whether it kept the
-- result or found the photo already light. A processed photo is no longer
-- offered, so a second pass never spends a transformation on it again.
--
-- NULL for every existing row: nothing changes until a merchant clicks.
ALTER TABLE media ADD COLUMN source_key TEXT;
ALTER TABLE media ADD COLUMN optimized_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_media_source_key ON media(source_key) WHERE source_key IS NOT NULL;
