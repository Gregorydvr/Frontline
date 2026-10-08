import { describe, expect, it } from 'vitest';
import { isUkMobile, ukMobile } from '../src/phone';

describe('ukMobile', () => {
  it.each([
    '07700 900001',
    '07700900001',
    '07700-900-001',
    '+447700900001',
    '+44 7700 900001',
    '00447700900001',
  ])('reads %s as +447700900001', (text) => {
    expect(ukMobile(text)).toBe('+447700900001');
  });

  it.each([
    ['a landline', '01632 960001'],
    ['too short', '07700 90000'],
    ['too long', '07700 9000011'],
    ['another country', '+33 6 12 34 56 78'],
    ['+44 with the 0 kept', '+44 07700 900001'],
    ['letters', '07700 9OOOO1'],
    ['nothing', ''],
  ])('refuses %s', (_, text) => {
    expect(() => ukMobile(text)).toThrow(RangeError);
  });
});

describe('isUkMobile', () => {
  it('knows the stored form only', () => {
    expect(isUkMobile('+447700900001')).toBe(true);
    expect(isUkMobile('07700 900001')).toBe(false);
    expect(isUkMobile(447700900001)).toBe(false);
  });
});
