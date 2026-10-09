// Booking during a call (slice E of docs/build-brief.md). The voice agent
// asks which times are free, and books one; the time is held in the diary
// under the call's id until the call ends and its customer and job are
// filed (src/land-call.ts).
//
// Only quote visits are booked by the voice agent. Each answer is JSON the
// agent reads: the times in the words it says ("Thursday 1 October at 3pm"),
// and the value to book each one by ("2026-10-01T15:00", UK time).

import type { CallRef, Diary } from './diary';
import { dateFromWords, startFromWords, startInWords, startToSay } from './diary/times';
import { log } from './log';
import type { Firm } from './record/types';

/** How many free times one answer gives. */
export const TIMES_OFFERED = 3;

/**
 * The free times for a quote visit: from the day the caller asks about
 * (`day`, such as "2026-10-01"), or from tomorrow.
 */
export async function answerFreeTimes(diary: Diary, firm: Firm, call: CallRef | null, args: Record<string, unknown> | null): Promise<string> {
  if (!firm.services.calls) {
    log('booking_while_calls_off', { firm: firm.id });
    return JSON.stringify({ times: [] });
  }
  const day = typeof args?.day === 'string' ? dateFromWords(args.day) : null;
  const free = await diary.freeTimes(firm.id, 'quote_visit', { from: day, count: TIMES_OFFERED, call });
  log('free_times_given', { firm: firm.id, times: free.length });
  return JSON.stringify({ times: free.map((time) => ({ start: startInWords(time.startsAt), say: startToSay(time.startsAt) })) });
}

/**
 * Books a quote visit at `start`, one of the values a free-times answer gave,
 * by holding it for the call. Booking again on the same call moves the
 * hold; with the same start, nothing changes.
 */
export async function answerBook(diary: Diary, firm: Firm, call: CallRef | null, args: Record<string, unknown> | null): Promise<string> {
  const startsAt = typeof args?.start === 'string' ? startFromWords(args.start) : null;
  if (call === null || startsAt === null) {
    log('tool_call_unreadable', { firm: firm.id });
    return JSON.stringify({ booked: false, why: 'unreadable' });
  }
  if (!firm.services.calls) {
    log('booking_while_calls_off', { firm: firm.id });
    return JSON.stringify({ booked: false, why: 'not_offered' });
  }
  const held = await diary.holdForCall(firm.id, call, 'quote_visit', startsAt);
  switch (held.result) {
    case 'held':
      log('time_held', { firm: firm.id, hold: held.hold });
      return JSON.stringify({ booked: true, start: startInWords(held.startsAt), say: startToSay(held.startsAt) });
    case 'taken':
      log('time_taken', { firm: firm.id });
      return JSON.stringify({ booked: false, why: 'taken' });
    case 'not_offered':
      log('time_not_offered', { firm: firm.id });
      return JSON.stringify({ booked: false, why: 'not_offered' });
  }
}
