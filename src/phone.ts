// UK phone numbers, kept in one form: +447700900001 for a mobile and
// +441632960001 for a landline. However a number was written ("07700
// 900001", "+44 7700 900001"), it is stored and compared this way, so the
// same number is always found.

declare const mobileBrand: unique symbol;
declare const landlineBrand: unique symbol;

/** A UK mobile number written as +447 and nine more digits. */
export type UkMobile = string & { readonly [mobileBrand]: true };

/**
 * A UK landline written as +44 and its nine or ten digits: a number starting
 * 01 or 02 (an area), or 03 (the same cost as one). No text can reach it.
 */
export type UkLandline = string & { readonly [landlineBrand]: true };

const STORED = /^\+447\d{9}$/;
const STORED_LANDLINE = /^\+44[123]\d{8,9}$/;
// The digits after the 0 or +44.
const MOBILE_DIGITS = /^7\d{9}$/;
const LANDLINE_DIGITS = /^[123]\d{8,9}$/;

/** Reads a UK mobile number. Refuses anything else, such as a landline. */
export function ukMobile(text: string): UkMobile {
  const national = nationalDigits(text);
  if (national === null || !MOBILE_DIGITS.test(national)) {
    throw new RangeError('Not a UK mobile number');
  }
  return `+44${national}` as UkMobile;
}

export function isUkMobile(value: unknown): value is UkMobile {
  return typeof value === 'string' && STORED.test(value);
}

/** Reads a UK landline. Refuses anything else, such as a mobile. */
export function ukLandline(text: string): UkLandline {
  const national = nationalDigits(text);
  if (national === null || !LANDLINE_DIGITS.test(national)) {
    throw new RangeError('Not a UK landline');
  }
  return `+44${national}` as UkLandline;
}

export function isUkLandline(value: unknown): value is UkLandline {
  return typeof value === 'string' && STORED_LANDLINE.test(value);
}

/** The number a call came from, sorted by whether a text can reach it. */
export type CallerNumber =
  | { kind: 'mobile'; number: UkMobile }
  | { kind: 'landline'; number: UkLandline }
  /** No number, or none that is a UK mobile or landline. */
  | { kind: 'withheld' };

/** Sorts the number a call came from. Anything that is not a UK mobile or landline counts as withheld. */
export function callerNumber(text: string | null): CallerNumber {
  const national = text === null ? null : nationalDigits(text);
  if (national !== null && MOBILE_DIGITS.test(national)) {
    return { kind: 'mobile', number: `+44${national}` as UkMobile };
  }
  if (national !== null && LANDLINE_DIGITS.test(national)) {
    return { kind: 'landline', number: `+44${national}` as UkLandline };
  }
  return { kind: 'withheld' };
}

/** A UK number's digits after the 0 or +44, or null if it is not written as a UK number. */
function nationalDigits(text: string): string | null {
  const digits = text.replace(/[\s-]/g, '');
  const national = /^0(\d{9,10})$/.exec(digits) ?? /^(?:\+44|0044)(\d{9,10})$/.exec(digits);
  return national?.[1] ?? null;
}

/** A stored number as people write it, such as "07700 900123". */
export function nationalNumber(number: UkMobile | UkLandline): string {
  const national = `0${number.slice(3)}`;
  return `${national.slice(0, 5)} ${national.slice(5)}`;
}
