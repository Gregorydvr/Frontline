// The check of Cloudflare Access's signed note (docs/access.md). Access puts
// a JSON Web Token in the Cf-Access-Jwt-Assertion header of every request it
// lets through. It is checked here with Web Crypto, with no package: signed
// with RS256 by one of the team's keys, for this application (its audience
// tag), from this team, not expired, and naming an email.
//
// The team's public keys are fetched from Access once, and again only when a
// note names a key not yet seen, as Access changes its keys from time to
// time. Tests give their own keys and never reach Cloudflare.

import type { Instant } from '../../clock';
import type { StaffGate } from '.';

/** The keys a team signs with, as Access publishes them. */
export type FetchKeys = (team: string) => Promise<JsonWebKey[]>;

/** The longest a note may be. Access's are about a kilobyte. */
const NOTE_LIMIT = 8_192;
/** How far a clock may be out, in seconds, when reading a note's times. */
const LEEWAY = 60;

export class CloudflareAccess implements StaffGate {
  private readonly team: string;
  private readonly audience: string;
  private readonly fetchKeys: FetchKeys;

  constructor(settings: { team: string; audience: string; fetchKeys?: FetchKeys }) {
    if (!/^[a-z0-9-]{1,63}$/.test(settings.team) || settings.audience.trim() === '') {
      throw new RangeError('Access is not set up');
    }
    this.team = settings.team;
    this.audience = settings.audience.trim();
    this.fetchKeys = settings.fetchKeys ?? accessKeys;
  }

  async whoIs(request: Request, now: Instant): Promise<string | null> {
    const note = request.headers.get('Cf-Access-Jwt-Assertion') ?? '';
    if (note === '' || note.length > NOTE_LIMIT) {
      return null;
    }
    const parts = note.split('.');
    const [head, body, signature] = parts;
    if (parts.length !== 3 || head === undefined || body === undefined || signature === undefined) {
      return null;
    }
    const header = jsonOf(head);
    const claims = jsonOf(body);
    if (header === null || claims === null || header.alg !== 'RS256' || typeof header.kid !== 'string') {
      return null;
    }
    const seconds = now / 1000;
    const audiences: unknown[] = Array.isArray(claims.aud) ? (claims.aud as unknown[]) : [claims.aud];
    if (
      !audiences.includes(this.audience) ||
      claims.iss !== `https://${this.team}.cloudflareaccess.com` ||
      typeof claims.exp !== 'number' ||
      claims.exp + LEEWAY <= seconds ||
      (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || claims.nbf - LEEWAY > seconds)) ||
      typeof claims.email !== 'string' ||
      claims.email === ''
    ) {
      return null;
    }
    const key = await this.keyFor(header.kid, now);
    const bytes = bytesOf(signature);
    if (key === null || bytes === null) {
      return null;
    }
    const signed = new TextEncoder().encode(`${head}.${body}`);
    const good = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, bytes, signed);
    return good ? claims.email : null;
  }

  /**
   * The team's key with this id. A key not yet seen sends for the keys again,
   * at most once every few minutes, so notes naming made-up keys cannot make
   * the Worker ask Access over and over.
   */
  private async keyFor(kid: string, now: Instant): Promise<CryptoKey | null> {
    const held = KEYS.get(this.team);
    const known = held === undefined ? undefined : (await held.keys).get(kid);
    if (known !== undefined) return known;
    if (held !== undefined && now - held.fetchedAt < REFETCH_AFTER) return null;
    const keys = importKeys(await this.fetchKeys(this.team).catch(() => []));
    KEYS.set(this.team, { keys, fetchedAt: now });
    return (await keys).get(kid) ?? null;
  }
}

/** The least time between two fetches of a team's keys. */
const REFETCH_AFTER = 5 * 60_000;

/** Each team's keys, kept for the life of the Worker, and when they were fetched. */
const KEYS = new Map<string, { keys: Promise<Map<string, CryptoKey>>; fetchedAt: number }>();

async function importKeys(jwks: JsonWebKey[]): Promise<Map<string, CryptoKey>> {
  const keys = new Map<string, CryptoKey>();
  for (const jwk of jwks) {
    const kid = (jwk as { kid?: unknown }).kid;
    if (typeof kid !== 'string' || jwk.kty !== 'RSA') continue;
    try {
      keys.set(kid, await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']));
    } catch {
      // A key that cannot be read signs nothing we accept.
    }
  }
  return keys;
}

/** The team's public keys, from Access itself. */
async function accessKeys(team: string): Promise<JsonWebKey[]> {
  const answer = await fetch(`https://${team}.cloudflareaccess.com/cdn-cgi/access/certs`);
  if (!answer.ok) return [];
  const body: unknown = await answer.json();
  const keys = typeof body === 'object' && body !== null ? (body as { keys?: unknown }).keys : undefined;
  return Array.isArray(keys) ? (keys as JsonWebKey[]) : [];
}

function jsonOf(part: string): Record<string, unknown> | null {
  const bytes = bytesOf(part);
  if (bytes === null) return null;
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Reads base64url, as a token is written. */
function bytesOf(part: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(part)) return null;
  const base64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
  try {
    return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}
