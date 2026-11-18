import { describe, expect, it } from 'vitest';
import { validateCustomFieldForm } from './customFields';
import { t } from '../i18n/index.ts';

/**
 * The editor's form as the route judges it: BEFORE its public IDs are
 * translated to row ids (api/admin/products/[id].ts), so every reference here
 * is a `cfld_`/`xtra_` public ID, as the page posts it.
 */
interface Row {
  id?: string;
  label: string;
  max?: number;
  required?: boolean;
  extra?: string;
}

function editorForm(
  rows: Row[],
  { remove = [], extras = [], removeExtras = [] }: { remove?: string[]; extras?: { id: string; label: string }[]; removeExtras?: string[] } = {},
): FormData {
  const form = new FormData();
  for (const extra of extras) {
    form.append('e_id', extra.id);
    form.append('e_label', extra.label);
    form.append('e_price', '3');
  }
  for (const id of removeExtras) form.append('e_remove', id);
  for (const row of rows) {
    form.append('c_id', row.id ?? '');
    form.append('c_label', row.label);
    form.append('c_help', '');
    form.append('c_max', String(row.max ?? 30));
    form.append('c_required', row.required === false ? '0' : '1');
    form.append('c_extra', row.extra ?? '');
  }
  for (const id of remove) form.append('c_remove', id);
  return form;
}

const PERSONALISATION = { id: 'xtra_0000000030', label: 'Personnalisation' };
const GIFT = { id: 'xtra_0000000031', label: 'Emballage cadeau' };

describe('validateCustomFieldForm', () => {
  it('takes a field that goes with one of the product’s extras', () => {
    const form = editorForm([{ id: 'cfld_0000000001', label: 'Prénom', extra: PERSONALISATION.id }], {
      extras: [PERSONALISATION, GIFT],
    });
    expect(validateCustomFieldForm(form)).toBeNull();
  });

  it('refuses to keep a field on an extra the same save deletes, naming the extra', () => {
    const form = editorForm([{ id: 'cfld_0000000001', label: 'Prénom', extra: PERSONALISATION.id }], {
      extras: [PERSONALISATION, GIFT],
      removeExtras: [PERSONALISATION.id],
    });
    expect(validateCustomFieldForm(form)).toBe(
      t('admin.products.customization.error.row', {
        numero: 1,
        erreur: t('admin.products.customization.error.extraRemoved', { option: 'Personnalisation' }),
      }),
    );
  });

  it('lets the extra go when its field turns « Toujours » or goes too, in the same save', () => {
    const always = editorForm([{ id: 'cfld_0000000001', label: 'Prénom', extra: '' }], {
      extras: [PERSONALISATION],
      removeExtras: [PERSONALISATION.id],
    });
    expect(validateCustomFieldForm(always)).toBeNull();
    const removed = editorForm([{ id: 'cfld_0000000001', label: 'Prénom', extra: PERSONALISATION.id }], {
      remove: ['cfld_0000000001'],
      extras: [PERSONALISATION],
      removeExtras: [PERSONALISATION.id],
    });
    expect(validateCustomFieldForm(removed)).toBeNull();
  });

  it('holds the same after translation to row ids', () => {
    const form = editorForm([{ id: '1', label: 'Prénom', extra: '30' }], {
      extras: [{ id: '30', label: 'Personnalisation' }],
      removeExtras: ['30'],
    });
    expect(validateCustomFieldForm(form)).toContain('Personnalisation');
  });

  it('does not count a field the same save removes toward the five', () => {
    const five = ['1', '2', '3', '4', '5'].map((n) => ({ id: `cfld_000000000${n}`, label: `Champ ${n}` }));
    const form = editorForm([...five, { label: 'Champ 6' }], { remove: ['cfld_0000000005'] });
    expect(validateCustomFieldForm(form)).toBeNull();
    expect(validateCustomFieldForm(editorForm([...five, { label: 'Champ 6' }]))).toBe(
      t('admin.products.customization.error.tooMany', { max: 5 }),
    );
  });
});
