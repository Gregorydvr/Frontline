import { afterEach, describe, expect, it, vi } from 'vitest';
import { idFromBytes } from '../src/ids';
import { errorName, log } from '../src/log';
import { Refused } from '../src/record/db';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('log', () => {
  it('writes one line of JSON with the event and its fields', () => {
    const console_ = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const firm = idFromBytes(new Uint8Array(16));
    log('unhandled_error', { firm, error: 'TypeError', attempt: 2, retried: true });
    expect(console_).toHaveBeenCalledTimes(1);
    expect(console_.mock.calls[0]).toEqual([
      JSON.stringify({ firm, error: 'TypeError', attempt: 2, retried: true, event: 'unhandled_error' }),
    ]);
  });

  it('keeps the event even if a field has the same name', () => {
    const console_ = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    // @ts-expect-error "event" is not an ErrorName, an id, a number or true/false.
    log('unhandled_error', { event: 'something else' });
    expect(console_.mock.calls[0]).toEqual([JSON.stringify({ event: 'unhandled_error' })]);
  });

  it('takes no free text', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    // @ts-expect-error A name is free text, not an id.
    log('unhandled_error', { customer: 'Mrs Ahmed' });
    // @ts-expect-error The event must come from the fixed list.
    log('Mrs Ahmed rang about her boiler');
  });
});

describe('errorName', () => {
  it('gives the type of a standard error, never its message', () => {
    expect(errorName(new TypeError('Mrs Ahmed, 27 Station Road'))).toBe('TypeError');
    expect(errorName(new RangeError('07700 900123'))).toBe('RangeError');
  });

  it("gives the record layer's refusal by its own name", () => {
    expect(errorName(new Refused())).toBe('Refused');
  });

  it('gives "Error" for anything else', () => {
    class MrsAhmedError extends Error {
      override name = 'Mrs Ahmed';
    }
    expect(errorName(new MrsAhmedError('boiler'))).toBe('Error');
    expect(errorName('Mrs Ahmed')).toBe('Error');
    expect(errorName({ name: 'TypeError' })).toBe('Error');
    expect(errorName(undefined)).toBe('Error');
  });
});
