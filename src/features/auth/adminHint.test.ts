import { describe, expect, it } from 'vitest';
import {
  ADMIN_HINT_COOKIE,
  ADMIN_PROBE_PATH,
  hasAdminHint,
  isAdminProbeAnswer,
  productEditHref,
} from './adminHint';

describe('hasAdminHint', () => {
  it('finds the hint among other cookies', () => {
    expect(hasAdminHint(`cart_n=2; ${ADMIN_HINT_COOKIE}=1`)).toBe(true);
    expect(hasAdminHint(`${ADMIN_HINT_COOKIE}=1;cart_n=2`)).toBe(true);
  });

  it('ignores an absent, cleared or look-alike cookie', () => {
    expect(hasAdminHint('')).toBe(false);
    expect(hasAdminHint('cart_n=2')).toBe(false);
    expect(hasAdminHint(`${ADMIN_HINT_COOKIE}=`)).toBe(false);
    expect(hasAdminHint(`${ADMIN_HINT_COOKIE}=0`)).toBe(false);
    expect(hasAdminHint(`x${ADMIN_HINT_COOKIE}=1`)).toBe(false);
    expect(hasAdminHint(`${ADMIN_HINT_COOKIE}=10`)).toBe(false);
  });
});

describe('isAdminProbeAnswer', () => {
  it('accepts only the answer the probe gives', () => {
    expect(isAdminProbeAnswer({ admin: true })).toBe(true);
    for (const body of [null, undefined, true, 'admin', {}, { admin: 'true' }, { admin: 1 }]) {
      expect(isAdminProbeAnswer(body)).toBe(false);
    }
  });
});

describe('productEditHref', () => {
  it('addresses the admin screen by public ID', () => {
    expect(productEditHref('prod_abc123')).toBe('/admin/products/prod_abc123/edit');
  });

  it('cannot be steered elsewhere by the ID', () => {
    expect(productEditHref('../../x')).toBe('/admin/products/..%2F..%2Fx/edit');
  });
});

describe('the probe', () => {
  it('sits behind the admin gate', () => {
    expect(ADMIN_PROBE_PATH.startsWith('/api/admin/')).toBe(true);
  });
});
