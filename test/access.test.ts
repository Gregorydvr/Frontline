// The check of Cloudflare Access's signed note (src/providers/access/), which
// stands in front of the control room on practice and live. Keys are made
// here and handed to the check, so nothing reaches Cloudflare.

import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { instantFromIso, pretendClock } from '../src/clock';
import { CloudflareAccess } from '../src/providers/access/cloudflare';
import { controlOpener } from './helpers/control';
import { testDeps } from './helpers/deps';

const clock = pretendClock(instantFromIso('2026-10-15T10:00:00+01:00'));
const seconds = clock.now() / 1000;
const AUDIENCE = 'aud-control-room-practice';
let teams = 0;

/** A key pair of Access's kind, with its id. */
async function keyPair(kid: string): Promise<{ privateKey: CryptoKey; jwk: JsonWebKey }> {
  const pair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey;
  return { privateKey: pair.privateKey, jwk: { ...jwk, kid } as JsonWebKey };
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function note(privateKey: CryptoKey, header: Record<string, unknown>, claims: Record<string, unknown>): Promise<string> {
  const encode = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)));
  const signed = `${encode(header)}.${encode(claims)}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(signed));
  return `${signed}.${base64url(new Uint8Array(signature))}`;
}

/** A check for a team of its own, with its key, and how many times it fetched the keys. */
async function aTeam() {
  teams += 1;
  const team = `frontline-test-${String(teams)}`;
  const key = await keyPair('key-1');
  const fetched = { times: 0 };
  const access = new CloudflareAccess({
    team,
    audience: AUDIENCE,
    fetchKeys: () => {
      fetched.times += 1;
      return Promise.resolve([key.jwk]);
    },
  });
  const claims = { aud: [AUDIENCE], iss: `https://${team}.cloudflareaccess.com`, email: 'staff@example.com', iat: seconds - 60, nbf: seconds - 60, exp: seconds + 3600 };
  const ask = (token: string | null) =>
    access.whoIs(new Request('https://control.example/control', { headers: token === null ? {} : { 'Cf-Access-Jwt-Assertion': token } }), clock.now());
  return { access, key, claims, ask, fetched };
}

describe('the check of Access’s note', () => {
  it('vouches for the email in a good note', async () => {
    const { key, claims, ask } = await aTeam();
    expect(await ask(await note(key.privateKey, { alg: 'RS256', kid: 'key-1' }, claims))).toBe('staff@example.com');
  });

  it('vouches for nobody with no note, or one that is not a note', async () => {
    const { ask } = await aTeam();
    expect(await ask(null)).toBeNull();
    expect(await ask('not.a.note')).toBeNull();
    expect(await ask('only-one-part')).toBeNull();
  });

  it('refuses a note that has expired, or is not yet good', async () => {
    const { key, claims, ask } = await aTeam();
    expect(await ask(await note(key.privateKey, { alg: 'RS256', kid: 'key-1' }, { ...claims, exp: seconds - 120 }))).toBeNull();
    expect(await ask(await note(key.privateKey, { alg: 'RS256', kid: 'key-1' }, { ...claims, nbf: seconds + 600 }))).toBeNull();
  });

  it('refuses a note for another application, or from another team', async () => {
    const { key, claims, ask } = await aTeam();
    expect(await ask(await note(key.privateKey, { alg: 'RS256', kid: 'key-1' }, { ...claims, aud: ['another-application'] }))).toBeNull();
    expect(await ask(await note(key.privateKey, { alg: 'RS256', kid: 'key-1' }, { ...claims, iss: 'https://elsewhere.cloudflareaccess.com' }))).toBeNull();
  });

  it('refuses a note signed with another key, under the team key’s id, or naming no way of signing', async () => {
    const { claims, ask } = await aTeam();
    const forged = await keyPair('key-1');
    expect(await ask(await note(forged.privateKey, { alg: 'RS256', kid: 'key-1' }, claims))).toBeNull();
    const [head, body] = (await note(forged.privateKey, { alg: 'none', kid: 'key-1' }, claims)).split('.');
    expect(await ask(`${head ?? ''}.${body ?? ''}.`)).toBeNull();
  });

  it('refuses a note with no email', async () => {
    const { key, claims, ask } = await aTeam();
    expect(await ask(await note(key.privateKey, { alg: 'RS256', kid: 'key-1' }, { ...claims, email: '' }))).toBeNull();
  });

  it('asks Access for its keys again for a key not seen, but not more than once every few minutes', async () => {
    const { key, claims, ask, fetched } = await aTeam();
    expect(await ask(await note(key.privateKey, { alg: 'RS256', kid: 'key-1' }, claims))).toBe('staff@example.com');
    expect(fetched.times).toBe(1);
    for (const kid of ['made-up-1', 'made-up-2', 'made-up-3']) {
      expect(await ask(await note(key.privateKey, { alg: 'RS256', kid }, claims))).toBeNull();
    }
    expect(fetched.times).toBe(1);
  });

  it('cannot be set up without a team and an audience', () => {
    expect(() => new CloudflareAccess({ team: '', audience: AUDIENCE })).toThrow(RangeError);
    expect(() => new CloudflareAccess({ team: 'frontline', audience: ' ' })).toThrow(RangeError);
    expect(() => new CloudflareAccess({ team: 'front line/evil', audience: AUDIENCE })).toThrow(RangeError);
  });
});

describe('the control room behind Access', () => {
  it('opens for a good note, and refuses a forged one', async () => {
    const { access, key, claims } = await aTeam();
    const open = controlOpener(createApp(() => ({ ...testDeps(clock), staff: access })));
    const good = await note(key.privateKey, { alg: 'RS256', kid: 'key-1' }, claims);
    expect((await open('/control', { headers: { 'Cf-Access-Jwt-Assertion': good } })).status).toBe(200);
    const forged = await note((await keyPair('key-1')).privateKey, { alg: 'RS256', kid: 'key-1' }, claims);
    expect((await open('/control', { headers: { 'Cf-Access-Jwt-Assertion': forged } })).status).toBe(403);
    expect((await open('/control')).status).toBe(403);
  });
});
