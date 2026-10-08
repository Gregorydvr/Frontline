import { describe, expect, it } from 'vitest';
import { callerNumber, isUkLandline, isUkMobile, ukLandline, ukMobile } from '../src/phone';

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

describe('ukLandline', () => {
  it.each(['01632 960001', '01632960001', '+44 1632 960001', '00441632960001', '020 7946 0001', '0300 555 0101'])(
    'reads %s',
    (text) => {
      expect(ukLandline(text)).toMatch(/^\+44[123]\d{8,9}$/);
    },
  );

  it('keeps one form, however it was written', () => {
    expect(ukLandline('01632 960001')).toBe('+441632960001');
    expect(ukLandline('+44 1632 960001')).toBe('+441632960001');
  });

  it.each([
    ['a mobile', '07700 900001'],
    ['a freephone number', '0800 123 4567'],
    ['too short', '01632 9600'],
    ['another country', '+33 1 23 45 67 89'],
    ['nothing', ''],
  ])('refuses %s', (_, text) => {
    expect(() => ukLandline(text)).toThrow(RangeError);
  });

  it('knows the stored form only', () => {
    expect(isUkLandline('+441632960001')).toBe(true);
    expect(isUkLandline('01632 960001')).toBe(false);
    expect(isUkLandline('+447700900001')).toBe(false);
  });
});

describe('callerNumber', () => {
  it('sorts a mobile, a landline and a withheld number', () => {
    expect(callerNumber('+447700900016')).toEqual({ kind: 'mobile', number: '+447700900016' });
    expect(callerNumber('+441632960001')).toEqual({ kind: 'landline', number: '+441632960001' });
    expect(callerNumber(null)).toEqual({ kind: 'withheld' });
  });

  it.each(['anonymous', 'Restricted', '+266696687', '+33612345678', '0800 123 4567', ''])(
    'counts %s as withheld, since no UK number came with it',
    (text) => {
      expect(callerNumber(text)).toEqual({ kind: 'withheld' });
    },
  );
});
