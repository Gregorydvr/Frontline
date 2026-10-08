import { describe, expect, it } from 'vitest';
import { formatMoney, pence, type Pence } from '../src/money';

describe('formatMoney', () => {
  it.each([
    [0, '£0'],
    [5, '£0.05'],
    [50, '£0.50'],
    [100, '£1'],
    [887, '£8.87'],
    [99_999, '£999.99'],
    [100_000, '£1,000'],
    [231_200, '£2,312'],
    [245_700, '£2,457'],
    [245_750, '£2,457.50'],
    [100_000_000, '£1,000,000'],
    [Number.MAX_SAFE_INTEGER, '£90,071,992,547,409.91'],
  ])('shows %i pence as %s', (amount, shown) => {
    expect(formatMoney(pence(amount))).toBe(shown);
  });

  it("puts the example app's minus sign before a negative amount", () => {
    expect(formatMoney(pence(-500))).toBe('−£5');
    expect(formatMoney(pence(-887))).toBe('−£8.87');
  });

  it('shows minus zero as £0', () => {
    expect(formatMoney(pence(-0))).toBe('£0');
  });

  it('refuses an amount that is not whole pence, even one forced past the types', () => {
    expect(() => formatMoney(8.87 as Pence)).toThrow(RangeError);
  });

  it('only takes Pence', () => {
    // @ts-expect-error A plain number is not Pence: it has to go through pence() first.
    expect(formatMoney(887)).toBe('£8.87');
  });
});

describe('pence', () => {
  it('takes a whole number of pence', () => {
    expect(pence(245_700)).toBe(245_700);
  });

  it.each([
    ['a fraction', 8.87],
    ['a float sum', 0.1 + 0.2],
    ['not a number', Number.NaN],
    ['infinity', Number.POSITIVE_INFINITY],
    ['minus infinity', Number.NEGATIVE_INFINITY],
    ['a number too big to hold exactly', 2 ** 53],
  ])('refuses %s', (_, amount) => {
    expect(() => pence(amount)).toThrow(RangeError);
  });
});
