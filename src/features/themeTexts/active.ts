import type { ThemeTextSlot } from '../storefront/models';
import { validThemeTextSlots } from './slots';

/**
 * The slots the ACTIVE theme declares, resolved at build time.
 *
 * `texts.ts` is optional — a theme that declares nothing is not changed by
 * ticket #165 — and a static import of a file that may not exist does not
 * build. A glob through the same `#theme` alias the templates use matches the
 * active theme's file or nothing, so the bundle carries one declaration or
 * none, never another theme's.
 *
 * Only the valid slots are kept: the suite fails on a bad declaration
 * (test/storefront/themeTexts.test.ts, every theme on disk), and a shop that
 * shipped one anyway keeps the slots it can read rather than a broken home.
 */
const declarations = Object.values(import.meta.glob<{ texts?: unknown }>('#theme/texts.ts', { eager: true }));

export const activeThemeTextSlots: readonly ThemeTextSlot[] = validThemeTextSlots(declarations[0]?.texts);
