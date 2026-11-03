import { parsePublicId } from '../ids/publicId';
import { t } from '../i18n/index.ts';

/** A category's description is a sentence or two under its name on a home
 *  page, not a page body: past this it belongs in a content page. */
export const CATEGORY_DESCRIPTION_MAX = 300;

/** Parsed category form fields (slug + parent resolved by the endpoint). */
export interface ParsedCategoryForm {
  name: string;
  slugInput: string;
  /** cat_ public ID from the parent selector; resolved to a row id at the boundary. */
  parentPublicId: string | null;
  /** Plain text, trimmed; null when empty. */
  description: string | null;
  /** The media key the picker chose; null clears the image. Resolved against
   *  `media` by the guarded write, never trusted as it stands. */
  imageKey: string | null;
}

export function parseCategoryForm(
  form: FormData,
): { data: ParsedCategoryForm } | { error: string } {
  const name = String(form.get('name') ?? '').trim();
  if (!name) return { error: t('admin.categories.error.nameRequired') };

  const slugInput = String(form.get('slug') ?? '').trim();

  // The selector submits cat_ public IDs; numeric ids are not accepted.
  const parentRaw = String(form.get('parent_id') ?? '').trim();
  let parentPublicId: string | null = null;
  if (parentRaw) {
    parentPublicId = parsePublicId(parentRaw, 'category');
    if (!parentPublicId) return { error: t('admin.categories.error.invalidParent') };
  }

  // Refused, not truncated: a sentence cut mid-word on the home page is worse
  // than a message asking for a shorter one. Line breaks fold to spaces — the
  // themes print it as one paragraph.
  const description = String(form.get('description') ?? '').replace(/\s+/g, ' ').trim();
  if ([...description].length > CATEGORY_DESCRIPTION_MAX) {
    return { error: t('admin.categories.error.descriptionTooLong', { max: CATEGORY_DESCRIPTION_MAX }) };
  }

  const imageKey = String(form.get('image_key') ?? '').trim();

  return {
    data: {
      name,
      slugInput,
      parentPublicId,
      description: description || null,
      imageKey: imageKey || null,
    },
  };
}
