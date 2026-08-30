import type { LocaleCatalog } from '../../../src/features/i18n';
import { fr } from '../../../src/features/i18n/messages';

/** The control case: a COMPLETE catalog compiles. Without it, the two failing
 *  fixtures would also pass if the whole directory simply failed to resolve. */
export const complete: LocaleCatalog = { ...fr };
