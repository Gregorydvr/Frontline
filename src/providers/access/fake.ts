// The stand-in for Cloudflare Access, on this machine and in tests: it
// vouches for one invented member of staff on every request. Never deployed:
// practice and live are built from src/index.ts, which uses the real check.

import type { StaffGate } from '.';

/** The invented member of staff on this machine and in tests. example.com belongs to nobody. */
export const EXAMPLE_STAFF_EMAIL = 'staff@example.com';

export class StandInStaff implements StaffGate {
  constructor(private readonly email: string = EXAMPLE_STAFF_EMAIL) {}

  whoIs(): Promise<string | null> {
    return Promise.resolve(this.email);
  }
}
