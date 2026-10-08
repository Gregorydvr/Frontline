import { afterEach, describe, expect, it, vi } from 'vitest';
import { idFromBytes, isId, newId } from '../src/ids';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('newId', () => {
  it('makes 26 characters of lowercase base 32', () => {
    const id = newId();
    expect(id).toMatch(/^[0-7][0-9a-hjkmnp-tv-z]{25}$/);
    expect(isId(id)).toBe(true);
  });

  it('never makes the same id twice in 10,000 tries', () => {
    const ids = new Set(Array.from({ length: 10_000 }, () => newId()));
    expect(ids.size).toBe(10_000);
  });

  it('takes its 16 bytes from the cryptographic random source', () => {
    const random = vi.spyOn(crypto, 'getRandomValues');
    newId();
    expect(random).toHaveBeenCalledTimes(1);
    const [bytes] = random.mock.calls[0] ?? [];
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect((bytes as Uint8Array).length).toBe(16);
  });
});

describe('idFromBytes', () => {
  // Worked out separately, with Python's whole-number arithmetic.
  it.each([
    [Array.from({ length: 16 }, () => 0), '00000000000000000000000000'],
    [Array.from({ length: 16 }, () => 255), '7zzzzzzzzzzzzzzzzzzzzzzzzz'],
    [[0x80, ...Array.from({ length: 15 }, () => 0)], '40000000000000000000000000'],
    [Array.from({ length: 16 }, (_, i) => i), '00041061050r3gg28a1c60t3gf'],
  ])('writes known bytes as a known id', (bytes, id) => {
    expect(idFromBytes(new Uint8Array(bytes))).toBe(id);
  });

  it.each([15, 17, 0])('refuses %i bytes', (length) => {
    expect(() => idFromBytes(new Uint8Array(length))).toThrow(RangeError);
  });
});

describe('isId', () => {
  it.each([
    ['upper case', '00041061050R3GG28A1C60T3GF'],
    ['too short', '00041061050r3gg28a1c60t3g'],
    ['too long', '00041061050r3gg28a1c60t3gff'],
    ['an i', '00041061050r3gg28a1c60t3gi'],
    ['an l', '00041061050r3gg28a1c60t3gl'],
    ['an o', '00041061050r3gg28a1c60t3go'],
    ['a u', '00041061050r3gg28a1c60t3gu'],
    ['a first character above 7', '80000000000000000000000000'],
    ['a number', 123],
    ['nothing', null],
  ])('refuses %s', (_, value) => {
    expect(isId(value)).toBe(false);
  });
});
