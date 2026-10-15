// The report on one call, for staff checking what happened on it
// (scripts/last-call.js): the call, its customer and job, the visit and the
// time held for it, every row in the due list that came with it, and every
// text it led to, the owner's urgent alert among them, and, for a booking,
// whether the customer's confirmation and the owners' text went or wait for
// quiet hours to end. Ids, states, kinds and times only: never a name, a number, an address or words from the call
// (rule 11), so the report can be shown in a terminal. Read only: it changes
// nothing in the record.

import { instant, type Instant } from './clock';
import { quietUntil } from './messages';
import { isUkLandline, isUkMobile } from './phone';
import {
  getCall,
  getCallRecording,
  getCustomer,
  getJob,
  getVisit,
  listDueForCall,
  listDueForVisit,
  listHoldsForCall,
  listMessagesBetween,
  listMessagesForJob,
} from './record';
import type { RecordDb } from './record/db';
import type { CallId, CustomerId, Due, DueAction, FirmId, Message } from './record/types';

/**
 * Where one of a booking's texts stands. Sent: on its way or gone, to at
 * least one person. Quiet hours: held until 8am. Waiting: not tried yet, or
 * held by the stop button or a service switch, to be tried again. Otherwise
 * how its row in the due list ended without a text going.
 */
export const BOOKING_TEXT_STATES = [
  'sent',
  'quiet_hours',
  'waiting',
  'not_sent',
  'failed',
  'too_late',
  'cancelled',
  'visit_changed',
  'nobody_to_tell',
] as const;
export type BookingTextState = (typeof BOOKING_TEXT_STATES)[number];

export interface BookingText {
  due: string;
  state: BookingTextState;
  /** When it goes, while it is held for quiet hours. */
  until: string | null;
  /** Why each of its texts that did not go did not, such as opted_out. */
  reasons: string[];
}

/** A text's states while it is going or has gone. */
const GOING: readonly Message['state'][] = ['sending', 'sent', 'delivered'];

export interface CallReportForStaff {
  call: {
    id: string;
    vapiId: string;
    startedAt: string;
    endedAt: string | null;
    /** What the call came from: a UK mobile a text can reach, a landline, or no number. */
    from: 'mobile' | 'landline' | 'withheld';
    outcome: string;
    urgentItem: string | null;
    hasSummary: boolean;
    hasTranscript: boolean;
    recording: string;
  };
  customer: { id: CustomerId; newOnThisCall: boolean; hasMobile: boolean; detailsConfirmed: boolean } | null;
  job: { id: string; urgent: boolean } | null;
  visit: { id: string; kind: string; state: string; startsAt: string; endsAt: string | null } | null;
  holds: { id: string; state: string; startsAt: string; visit: string | null; heldAt: string; changedAt: string }[];
  due: { id: string; action: string; state: string; outcome: string | null; runAt: string; latestAt: string; finishedAt: string | null }[];
  /**
   * The two texts a visit booked on the call leads to: the customer's
   * confirmation, and the text telling the firm's owners. Each is null when
   * the call booked no visit, or the visit has no such row in the due list.
   */
  booking: { customerText: BookingText | null; ownerText: BookingText | null };
  texts: {
    id: string;
    kind: string;
    to: 'customer' | 'owner';
    state: string;
    reason: string | null;
    segments: number | null;
    errorCode: number | null;
    createdAt: string;
    sentAt: string | null;
  }[];
}

/** The report on one of the firm's calls, or null when the firm has no such call. */
export async function callReportForStaff(db: RecordDb, firm: FirmId, call: CallId): Promise<CallReportForStaff | null> {
  const found = await getCall(db, firm, call);
  if (found === null) {
    return null;
  }
  const customer = found.customer === null ? null : await getCustomer(db, firm, found.customer.id);
  const job = found.job === null ? null : await getJob(db, firm, found.job);
  const visit = found.visit === null ? null : await getVisit(db, firm, found.visit.id);
  const recording = await getCallRecording(db, firm, found.id);
  const holds = await listHoldsForCall(db, firm, found.provider, found.providerCallId);

  const due = new Map<string, Due>();
  for (const row of await listDueForCall(db, firm, found.id)) due.set(row.id, row);
  if (visit !== null) {
    for (const row of await listDueForVisit(db, firm, visit.id)) due.set(row.id, row);
  }
  // The texts any of those rows led to: those about the job, and an alert
  // with no job, which goes out from the moment the call is kept.
  const texts = new Map<string, Message>();
  const candidates = [
    ...(job === null ? [] : await listMessagesForJob(db, firm, job.id)),
    ...(await listMessagesBetween(db, firm, found.createdAt, instant(db.clock.now() + 1))),
  ];
  for (const message of candidates) {
    if (due.has(message.due)) texts.set(message.id, message);
  }

  return {
    call: {
      id: found.id,
      vapiId: found.providerCallId,
      startedAt: iso(found.startedAt),
      endedAt: found.endedAt === null ? null : iso(found.endedAt),
      from: isUkMobile(found.from) ? 'mobile' : isUkLandline(found.from) ? 'landline' : 'withheld',
      outcome: found.outcome,
      urgentItem: found.urgentItem,
      hasSummary: found.summary !== null,
      hasTranscript: found.transcript !== null,
      recording: recording?.state ?? 'none',
    },
    customer:
      customer === null
        ? null
        : {
            id: customer.id,
            newOnThisCall: customer.createdAt >= found.startedAt,
            hasMobile: customer.mobile !== null,
            detailsConfirmed: customer.detailsConfirmedAt !== null,
          },
    job: job === null ? null : { id: job.id, urgent: job.urgent },
    visit:
      visit === null
        ? null
        : { id: visit.id, kind: visit.kind, state: visit.state, startsAt: iso(visit.startsAt), endsAt: visit.endsAt === null ? null : iso(visit.endsAt) },
    holds: holds.map((hold) => ({
      id: hold.id,
      state: hold.state,
      startsAt: iso(hold.startsAt),
      visit: hold.visit,
      heldAt: iso(hold.createdAt),
      changedAt: iso(hold.updatedAt),
    })),
    due: [...due.values()]
      .sort((a, b) => a.runAt - b.runAt)
      .map((row) => ({
        id: row.id,
        action: row.action,
        state: row.state,
        outcome: row.outcome,
        runAt: iso(row.runAt),
        latestAt: iso(row.latestAt),
        finishedAt: row.finishedAt === null ? null : iso(row.finishedAt),
      })),
    booking: {
      customerText: bookingText(visit === null ? [] : [...due.values()], 'send_confirmation', [...texts.values()]),
      ownerText: bookingText(visit === null ? [] : [...due.values()], 'tell_owner_booked', [...texts.values()]),
    },
    texts: [...texts.values()].map((text) => ({
      id: text.id,
      kind: text.kind,
      to: text.to.kind,
      state: text.state,
      reason: text.reason,
      segments: text.segments,
      errorCode: text.errorCode,
      createdAt: iso(text.createdAt),
      sentAt: text.sentAt === null ? null : iso(text.sentAt),
    })),
  };
}

/** Where the booking's text sent by the row with this action stands, or null when there is no such row. */
function bookingText(rows: readonly Due[], action: DueAction, texts: readonly Message[]): BookingText | null {
  const row = rows.find((candidate) => candidate.action === action);
  if (row === undefined) {
    return null;
  }
  const its = texts.filter((text) => text.due === row.id);
  const reasons = its.flatMap((text) => (text.reason === null ? [] : [text.reason]));
  const answer = (state: BookingTextState, until: Instant | null = null): BookingText => ({
    due: row.id,
    state,
    until: until === null ? null : iso(until),
    reasons,
  });
  if (its.some((text) => GOING.includes(text.state))) {
    return answer('sent');
  }
  if (row.state === 'waiting' || row.state === 'claimed') {
    // A row held for quiet hours waits with its time moved on to 8am
    // (src/due.ts); one held by the stop button or a switch keeps its time.
    const heldForQuietHours = row.runAt > row.createdAt && quietUntil(instant(row.runAt - 1)) === row.runAt;
    return heldForQuietHours ? answer('quiet_hours', row.runAt) : answer('waiting');
  }
  if (row.state === 'cancelled') {
    return answer('cancelled');
  }
  return answer(BOOKING_TEXT_STATES.find((state) => state === row.outcome) ?? 'not_sent');
}

function iso(at: Instant): string {
  return new Date(at).toISOString();
}
