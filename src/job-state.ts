// A job's state is worked out from its records each time it is shown, not
// stored, so nothing has to change it at midnight. Release 1 produces three
// of the example's states. The others come from quotes and invoices, when
// later releases add them.

import type { Instant } from './clock';
import { londonDay } from './london';
import type { Job, Visit } from './record/types';

/** As the example app names them: "Passed to you", "On today" and "Booked". */
export type JobState = 'urgent' | 'today' | 'booked';

/**
 * Urgent first. Then "on today" if a booked visit falls on today's UK date,
 * even one earlier in the day. Then "booked" if one is still to come. Otherwise
 * the job has no state yet.
 */
export function jobState(
  job: Pick<Job, 'urgent'>,
  visits: readonly Pick<Visit, 'startsAt' | 'state'>[],
  now: Instant,
): JobState | null {
  if (job.urgent) {
    return 'urgent';
  }
  const booked = visits.filter((visit) => visit.state === 'booked');
  const today = londonDay(now);
  if (booked.some((visit) => londonDay(visit.startsAt) === today)) {
    return 'today';
  }
  if (booked.some((visit) => visit.startsAt > now)) {
    return 'booked';
  }
  return null;
}
