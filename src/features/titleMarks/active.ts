import { validTitleMarks } from './marks';

/**
 * The title codes the ACTIVE theme declares (ticket #251), resolved at build
 * time.
 *
 * `titles.ts` is optional — a theme that declares nothing is not changed — and
 * a static import of a file that may not exist does not build. A glob through
 * the `#theme` alias matches the active theme's file or nothing, as for the
 * theme's texts (features/themeTexts/active.ts).
 *
 * Only the valid codes are kept: the suite fails on a bad declaration
 * (test/storefront/titleMarks.test.ts, every theme on disk).
 */
const declarations = Object.values(import.meta.glob<{ titleMarks?: unknown }>('#theme/titles.ts', { eager: true }));

export const activeTitleMarks: readonly string[] = validTitleMarks(declarations[0]?.titleMarks);
