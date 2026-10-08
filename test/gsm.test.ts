// Rule 4 in CLAUDE.md: texts use GSM-7 characters only, and the segments are
// counted.

import { describe, expect, it } from 'vitest';
import { isGsm7, notGsm7, plainForText, segments } from '../src/gsm';

describe('isGsm7', () => {
  it('takes plain letters, numbers, straight quotes and the pound sign', () => {
    expect(isGsm7('Reminder: Tom\'s visit is tomorrow, Thursday, at 3pm. See you then.')).toBe(true);
    expect(isGsm7('A deposit of £630, "paid" straight to your account.')).toBe(true);
    expect(isGsm7('Café, Ñ, ü, € and {braces}')).toBe(true);
  });

  it('refuses a curly apostrophe, curly quotes, a long dash and an emoji', () => {
    expect(isGsm7('Tom’s visit')).toBe(false);
    expect(isGsm7('“See you then”')).toBe(false);
    expect(isGsm7('3pm – 4pm')).toBe(false);
    expect(isGsm7('See you then 👍')).toBe(false);
    expect(notGsm7('Tom’s visit – 👍 ’')).toEqual(['’', '–', '👍']);
  });
});

describe('segments', () => {
  it('fits 160 plain characters in one segment, and 161 in two', () => {
    expect(segments('a'.repeat(160))).toBe(1);
    expect(segments('a'.repeat(161))).toBe(2);
    expect(segments('a'.repeat(306))).toBe(2);
    expect(segments('a'.repeat(307))).toBe(3);
  });

  it('counts the extension characters twice, and never splits one', () => {
    expect(segments('€'.repeat(80))).toBe(1);
    expect(segments('€'.repeat(81))).toBe(2);
    // 152 places, then a euro that does not fit in the first segment's 153.
    expect(segments(`${'a'.repeat(152)}€${'a'.repeat(10)}`)).toBe(2);
    expect(segments(`${'a'.repeat(152)}€${'a'.repeat(152)}`)).toBe(3);
  });

  it('counts nothing for no text, and refuses a text that is not GSM-7', () => {
    expect(segments('')).toBe(0);
    expect(() => segments('Tom’s')).toThrow(RangeError);
  });
});

describe('plainForText', () => {
  it('makes a caller’s curly quotes and dashes straight', () => {
    expect(plainForText('Mrs O’Brien')).toBe("Mrs O'Brien");
    expect(plainForText('“Flat 2” – 9 Mill Road…')).toBe('"Flat 2" - 9 Mill Road...');
  });

  it('turns anything else a text cannot carry into a question mark', () => {
    expect(plainForText('Mr Łukasz 👍')).toBe('Mr ?ukasz ?');
    expect(isGsm7(plainForText('Ā ā 中  '))).toBe(true);
  });
});
