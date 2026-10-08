// Shared secrets: how a provider that calls us, such as Vapi, proves who it
// is. The secret itself lives in the Worker's secrets, never in the
// repository (rule 12 in CLAUDE.md).

/** A secret shorter than this is treated as not set up, so a weak one cannot be used by mistake. */
export const SHORTEST_SECRET = 32;

/** The token in an `Authorization: Bearer <token>` header, or null. */
export function bearerToken(header: string | undefined): string | null {
  const match = /^Bearer +(\S+)$/i.exec(header ?? '');
  return match?.[1] ?? null;
}

/**
 * Whether the secret given matches the one set up, compared in a way that
 * takes the same time however much of it matches. With no secret set up,
 * nothing matches.
 */
export async function sameSecret(given: string | null, expected: unknown): Promise<boolean> {
  if (given === null || typeof expected !== 'string' || expected.length < SHORTEST_SECRET) {
    return false;
  }
  // Hashing both first makes them the same length, so the comparison gives
  // away nothing about the secret's length either.
  const [a, b] = await Promise.all([digest(given), digest(expected)]);
  return crypto.subtle.timingSafeEqual(a, b);
}

async function digest(text: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
}
