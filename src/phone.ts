// UK mobile numbers, kept in one form: +447700900001. However a number was
// written ("07700 900001", "+44 7700 900001"), it is stored and compared
// this way, so the same mobile is always found.

declare const mobileBrand: unique symbol;

/** A UK mobile number written as +447 and nine more digits. */
export type UkMobile = string & { readonly [mobileBrand]: true };

const STORED = /^\+447\d{9}$/;

/** Reads a UK mobile number. Refuses anything else, such as a landline. */
export function ukMobile(text: string): UkMobile {
  const compact = text.replace(/[\s-]/g, '');
  const national = /^07\d{9}$/.test(compact)
    ? compact.slice(1)
    : /^(?:\+44|0044)7\d{9}$/.test(compact)
      ? compact.slice(compact.indexOf('7'))
      : null;
  if (national === null) {
    throw new RangeError('Not a UK mobile number');
  }
  return `+44${national}` as UkMobile;
}

export function isUkMobile(value: unknown): value is UkMobile {
  return typeof value === 'string' && STORED.test(value);
}
