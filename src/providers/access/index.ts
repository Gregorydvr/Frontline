// Who is looking at the control room. On practice and live, Cloudflare Access
// stands in front of it and vouches for the member of staff with a signed
// note on every request (docs/access.md); the Worker checks the note itself,
// so a mistake in Access's set-up does not open the control room. On this
// machine a stand-in names the invented "Example Staff". Tests never reach
// Cloudflare.

import type { Instant } from '../../clock';

export interface StaffGate {
  /**
   * The email of the member of staff making this request, as the gate
   * vouches for it, or null when it does not: no note, or one that is
   * expired, for another application, or not signed by Access.
   */
  whoIs(request: Request, now: Instant): Promise<string | null>;
}

/** The gate while Access is not set up for this copy: it vouches for nobody, so the control room is shut. */
export const CLOSED_GATE: StaffGate = {
  whoIs: () => Promise.resolve(null),
};
