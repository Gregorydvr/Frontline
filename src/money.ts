// Money is whole pence in an integer, in code and in the database (rule 5 in
// CLAUDE.md). Nothing here uses a fraction or a float.

declare const penceBrand: unique symbol;

/** An amount of money in whole pence. */
export type Pence = number & { readonly [penceBrand]: true };

/** Checks that an amount is a whole number of pence, and marks it as Pence. */
export function pence(amount: number): Pence {
  if (!Number.isSafeInteger(amount)) {
    throw new RangeError('Money is a whole number of pence');
  }
  return amount as Pence;
}

/**
 * Shows an amount as settled in docs/decisions.md: "£2,457" for whole pounds,
 * "£8.87" or "£2,457.50" when there are pence. A negative amount starts with
 * the example app's minus sign, as in "−£5".
 */
export function formatMoney(amount: Pence): string {
  const whole = pence(amount);
  const sign = whole < 0 ? '−' : '';
  const size = Math.abs(whole);
  const pennies = size % 100;
  const pounds = (size - pennies) / 100;
  const poundsText = String(pounds).replace(/\B(?=(\d{3})+$)/g, ',');
  const penniesText = pennies === 0 ? '' : '.' + String(pennies).padStart(2, '0');
  return `${sign}£${poundsText}${penniesText}`;
}
