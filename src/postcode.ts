// UK postcodes, kept in one form: capitals, with one space before the last
// three characters, such as ZZ1 4AB. However the voice agent wrote one
// ("zz14ab", "ZZ1  4AB"), it is kept this way. Only the form is checked, not
// that the postcode exists: Front-line holds no list of them.

// The part before the space (ZZ1, ZZ12, Z1A, ZZ1A), then a number and two letters.
const POSTCODE = /^[A-Z]{1,2}[0-9][A-Z0-9]?[0-9][A-Z]{2}$/;

/** A UK postcode written as ZZ1 4AB, or null for anything that is not one. */
export function ukPostcode(text: string): string | null {
  const joined = text.replace(/\s+/g, '').toUpperCase();
  return POSTCODE.test(joined) ? `${joined.slice(0, -3)} ${joined.slice(-3)}` : null;
}
