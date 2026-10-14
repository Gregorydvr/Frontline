import { describe, expect, it } from 'vitest';
import { ukPostcode } from '../src/postcode';

// The postcodes here are in the ZZ area, which the UK does not have, so none is a real one.
describe('ukPostcode', () => {
  it.each([
    ['ZZ1 4AB', 'ZZ1 4AB'],
    ['zz1 4ab', 'ZZ1 4AB'],
    ['ZZ14AB', 'ZZ1 4AB'],
    ['  ZZ1   4AB ', 'ZZ1 4AB'],
    ['Z1 4AB', 'Z1 4AB'],
    ['Z12 4AB', 'Z12 4AB'],
    ['ZZ12 4AB', 'ZZ12 4AB'],
    ['Z1A 4AB', 'Z1A 4AB'],
    ['ZZ1A 4AB', 'ZZ1A 4AB'],
  ])('keeps %j as %j', (written, kept) => {
    expect(ukPostcode(written)).toBe(kept);
  });

  it.each(['', 'ZZ1', '4AB', 'ZZ1 4A', 'ZZ1 44B', 'ZZZ1 4AB', 'ZZ123 4AB', '1Z1 4AB', 'ZZ1-4AB', 'ZZ1 4AB.', 'Z Z one four A B'])(
    'refuses %j',
    (written) => {
      expect(ukPostcode(written)).toBeNull();
    },
  );
});
