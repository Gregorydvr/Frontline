// Texts use the GSM-7 characters only (rule 4 in CLAUDE.md). One character
// outside them, such as a curly apostrophe or an emoji, sends the whole text
// in another format that holds 70 characters a segment in place of 160.
//
// The characters are those of the GSM 03.38 alphabet: its basic table, and
// its extension table, whose characters take two places each.

const BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';

/** The extension table's characters, each sent as an escape and itself. */
const EXTENDED = '^{}\\[~]|€';

const ONE_SEGMENT = 160;
/** A text in several segments loses 7 places in each to the header that joins them. */
const PER_SEGMENT = 153;

/** Whether every character of the text is one a text can carry as GSM-7. */
export function isGsm7(text: string): boolean {
  return characters(text).every((character) => BASIC.includes(character) || EXTENDED.includes(character));
}

/** The characters of the text that GSM-7 cannot carry, each once, in order. */
export function notGsm7(text: string): string[] {
  return [...new Set(characters(text).filter((character) => !BASIC.includes(character) && !EXTENDED.includes(character)))];
}

/**
 * How many segments a GSM-7 text takes, as the phone networks count them. An
 * extension character takes two places and is never split between segments.
 * Refuses a text that is not GSM-7.
 */
export function segments(text: string): number {
  if (!isGsm7(text)) {
    throw new RangeError('Not a GSM-7 text');
  }
  const sizes = characters(text).map((character) => (EXTENDED.includes(character) ? 2 : 1));
  const total = sizes.reduce((sum, size) => sum + size, 0);
  if (total <= ONE_SEGMENT) {
    return total === 0 ? 0 : 1;
  }
  let count = 1;
  let used = 0;
  for (const size of sizes) {
    if (used + size > PER_SEGMENT) {
      count += 1;
      used = 0;
    }
    used += size;
  }
  return count;
}

// Lookalikes that people and speech-to-text often write, each with the plain
// character a text can carry.
const LOOKALIKES: readonly (readonly [RegExp, string])[] = [
  [/[\u2018\u2019\u201A\u201B\u2032]/gu, "'"],
  [/[\u201C\u201D\u201E\u201F\u2033]/gu, '"'],
  [/[\u2010-\u2015\u2212]/gu, '-'],
  [/\u2026/gu, '...'],
  [/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/gu, ' '],
];

/**
 * Words from a caller, such as a name or an address, made fit to go into a
 * text: curly quotes and dashes become straight ones, and any other
 * character a text cannot carry becomes "?". Only for what people said. A
 * firm's agreed wording is never changed this way: it is refused instead.
 */
export function plainForText(words: string): string {
  let plain = words;
  for (const [lookalike, replacement] of LOOKALIKES) {
    plain = plain.replace(lookalike, replacement);
  }
  return characters(plain)
    .map((character) => (isGsm7(character) ? character : '?'))
    .join('');
}

/**
 * The characters of a text one by one, as the phone networks count them: an
 * emoji made of two halves in JavaScript is one character, not two.
 */
function characters(text: string): string[] {
  return Array.from(text);
}
