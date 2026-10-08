import { describe, expect, it } from 'vitest';
import { bearerToken, sameSecret, SHORTEST_SECRET } from '../src/secret';

const secret = 'a'.repeat(SHORTEST_SECRET);

describe('bearerToken', () => {
  it('takes the token from "Bearer <token>"', () => {
    expect(bearerToken(`Bearer ${secret}`)).toBe(secret);
    expect(bearerToken(`bearer ${secret}`)).toBe(secret);
  });

  it.each([undefined, '', 'Bearer', 'Bearer ', secret, `Basic ${secret}`, `Bearer ${secret} more`])(
    'finds no token in %j',
    (header) => {
      expect(bearerToken(header)).toBeNull();
    },
  );
});

describe('sameSecret', () => {
  it('matches only the same secret', async () => {
    expect(await sameSecret(secret, secret)).toBe(true);
    expect(await sameSecret(`${secret}b`, secret)).toBe(false);
    expect(await sameSecret(secret.slice(1), secret)).toBe(false);
    expect(await sameSecret(null, secret)).toBe(false);
  });

  it('matches nothing when no secret, or one too short to be safe, is set up', async () => {
    expect(await sameSecret('', '')).toBe(false);
    expect(await sameSecret('short', 'short')).toBe(false);
    expect(await sameSecret(secret, undefined)).toBe(false);
    expect(await sameSecret(secret, 42)).toBe(false);
  });
});
