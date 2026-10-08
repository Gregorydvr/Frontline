// Ids that cannot be guessed. Each is 128 random bits from the runtime's
// cryptographic random source, written as 26 characters of lowercase
// Crockford base 32. They are safe in a web address, in a text message and in
// a log line.

declare const idBrand: unique symbol;

/** An id made by newId(). */
export type Id = string & { readonly [idBrand]: true };

// Crockford's base 32 in lower case: no i, l, o or u, so nothing reads as
// another character.
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
const ID_BYTES = 16;
const ID_LENGTH = 26;
// 26 characters hold 130 bits, so the first one only ever carries 3 of them.
const ID_PATTERN = /^[0-7][0-9a-hjkmnp-tv-z]{25}$/;

export function newId(): Id {
  return idFromBytes(crypto.getRandomValues(new Uint8Array(ID_BYTES)));
}

/** Writes 16 bytes as an id. newId() passes random ones; tests pass known ones. */
export function idFromBytes(bytes: Uint8Array): Id {
  if (bytes.length !== ID_BYTES) {
    throw new RangeError('An id is made from 16 bytes');
  }
  let bits = 0n;
  for (const byte of bytes) {
    bits = (bits << 8n) | BigInt(byte);
  }
  const characters: string[] = [];
  for (let i = 0; i < ID_LENGTH; i++) {
    characters.push(ALPHABET.charAt(Number(bits & 31n)));
    bits >>= 5n;
  }
  return characters.reverse().join('') as Id;
}

export function isId(value: unknown): value is Id {
  return typeof value === 'string' && ID_PATTERN.test(value);
}
