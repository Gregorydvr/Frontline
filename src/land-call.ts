// A call lands in the record (slice C of docs/build-brief.md). From the
// report that comes when a call ends: find the firm by the number that was
// rung, find the customer by the caller's number within that firm or make
// one, open a job, and store the call with its outcome and its history.
//
// The outcome is worked out here, never taken from the voice agent: urgent
// when the call matched an item on the firm's own urgent list, booked when a
// time was held in the diary during the call (src/booking.ts), otherwise a
// message taken.
//
// A time held during the call is filed here, as a visit on the job the call
// opens, in the same step as the call, with its confirmation and reminder in
// the due list. An urgent call, or one whose details did not come through,
// has no job to put a visit on, or is the owner's to deal with: its held
// time is let go, and a log line tells staff.

import { bookingDues } from './diary/times';
import { log } from './log';
import type { CallerNumber } from './phone';
import {
  findCallByProviderId,
  findCustomersByLandline,
  findCustomersByMobile,
  findFirmByNumber,
  findHoldForCall,
  getFirm,
  recordCall,
  releaseHold,
} from './record';
import type { RecordedCall } from './record/calls';
import { Refused, type RecordDb } from './record/db';
import type { CallFor, CallId, Customer, DueId, Firm, FirmId, NewBooking, VisitId } from './record/types';
import type { CallDetails, CallReport } from './vapi-report';

export type Landed =
  /**
   * Stored. An urgent call comes with the row in the due list that alerts
   * the owner; a booked one with its visit and the visit's rows.
   */
  | { result: 'stored'; firm: FirmId; call: CallId; alert: DueId | null; booking: { visit: VisitId; dues: DueId[] } | null }
  /** The record already held this call, so nothing changed. */
  | { result: 'repeat'; firm: FirmId; call: CallId }
  /** No firm has the number that was rung. Nothing was kept. */
  | { result: 'unknown_number' };

export async function landCall(db: RecordDb, report: CallReport): Promise<Landed> {
  const firmId = report.firmNumber === null ? null : await findFirmByNumber(db, report.firmNumber);
  const firm = firmId === null ? null : await getFirm(db, firmId);
  if (firm === null) {
    log('call_for_unknown_number');
    return { result: 'unknown_number' };
  }

  const already = await findCallByProviderId(db, firm.id, 'vapi', report.providerCallId);
  if (already !== null) {
    log('call_repeated', { firm: firm.id, call: already });
    return { result: 'repeat', firm: firm.id, call: already };
  }

  const urgentItem = urgentItemOf(firm, report.details);
  const forWhom = await callFor(db, firm.id, report.from, report.details);
  const hold = await findHoldForCall(db, firm.id, 'vapi', report.providerCallId);
  const canBook = urgentItem === null && (forWhom.kind === 'new_customer' || forWhom.kind === 'customer');
  const booking: NewBooking | null =
    hold !== null && canBook
      ? {
          hold: hold.id,
          kind: hold.kind,
          startsAt: hold.startsAt,
          endsAt: hold.endsAt,
          dues: bookingDues(hold.startsAt, db.clock.now()),
        }
      : null;
  let made: RecordedCall;
  try {
    made = await recordCall(db, firm.id, {
      provider: 'vapi',
      providerCallId: report.providerCallId,
      // A report without its times is kept as of when it arrived.
      startedAt: report.startedAt ?? report.endedAt ?? db.clock.now(),
      endedAt: report.endedAt,
      from: report.from.kind === 'withheld' ? null : report.from.number,
      for: forWhom,
      urgentItem,
      summary: report.details?.summary ?? null,
      transcript: report.transcript,
      booking,
    });
  } catch (thrown) {
    // The same report arriving twice at once: the second is refused by the
    // database, and finds the first.
    const first = thrown instanceof Refused ? await findCallByProviderId(db, firm.id, 'vapi', report.providerCallId) : null;
    if (first === null) {
      throw thrown;
    }
    log('call_repeated', { firm: firm.id, call: first });
    return { result: 'repeat', firm: firm.id, call: first };
  }

  log('call_stored', { firm: firm.id, call: made.call });
  if (made.visit !== null) {
    log('hold_filed', { firm: firm.id, call: made.call, visit: made.visit });
  } else if (hold !== null && (await releaseHold(db, firm.id, hold.id))) {
    // A time was held on a call that cannot be booked. Staff should know a
    // caller may have been told a time.
    log('hold_released', { firm: firm.id, call: made.call, hold: hold.id });
  }
  if (report.details?.callerType === 'customer' && report.details.urgentMatch !== null && urgentItem === null) {
    log('urgent_not_on_list', { firm: firm.id, call: made.call });
  }
  if (!firm.services.calls) {
    // The call really happened, so it is kept. Staff should know the
    // firm's calls are being answered while the service is off.
    log('call_while_calls_off', { firm: firm.id, call: made.call });
  }
  return {
    result: 'stored',
    firm: firm.id,
    call: made.call,
    alert: made.alert,
    booking: made.visit === null ? null : { visit: made.visit, dues: made.dues },
  };
}

/**
 * The item on the firm's urgent list that the call matched, as the firm's
 * list writes it. Only a customer's call can be urgent. What the agent wrote
 * must be on the list, ignoring capitals and spaces.
 */
function urgentItemOf(firm: Firm, details: CallDetails | null): string | null {
  if (details?.callerType !== 'customer' || details.urgentMatch === null) {
    return null;
  }
  const match = details.urgentMatch;
  return firm.urgentList.find((item) => sameWords(item, match)) ?? null;
}

/**
 * Who the call was for. A caller who gave a name, what the job is about and
 * an address is a customer; anything less is a call with details missing.
 *
 * Every customer's call opens a new job for now. When a second call should
 * join an open job is open question 5 in docs/decisions.md.
 */
async function callFor(
  db: RecordDb,
  firm: FirmId,
  from: CallerNumber,
  details: CallDetails | null,
): Promise<CallFor> {
  if (details === null) {
    return { kind: 'details_missing' };
  }
  if (details.callerType === 'other') {
    return details.whoRang === null ? { kind: 'details_missing' } : { kind: 'not_customer', caller: details.whoRang };
  }
  const { name, about, address } = details;
  if (name === null || about === null || address === null) {
    return { kind: 'details_missing' };
  }
  // The customer on the same number with the same name. Two people can share
  // a number, and a second customer is safer than mixing them up.
  const known = (await customersOn(db, firm, from)).find((customer) => sameWords(customer.name, name));
  if (known !== undefined) {
    return { kind: 'customer', customer: known.id, about, place: address };
  }
  switch (from.kind) {
    case 'mobile':
      return { kind: 'new_customer', name, mobile: from.number, landline: null, noText: null, about, place: address };
    case 'landline':
      return { kind: 'new_customer', name, mobile: null, landline: from.number, noText: 'landline', about, place: address };
    case 'withheld':
      return { kind: 'new_customer', name, mobile: null, landline: null, noText: 'withheld', about, place: address };
  }
}

/** This firm's customers on the number the call came from. A withheld number finds nobody. */
async function customersOn(db: RecordDb, firm: FirmId, from: CallerNumber): Promise<Customer[]> {
  switch (from.kind) {
    case 'mobile':
      return findCustomersByMobile(db, firm, from.number);
    case 'landline':
      return findCustomersByLandline(db, firm, from.number);
    case 'withheld':
      return [];
  }
}

function sameWords(a: string, b: string): boolean {
  const plain = (words: string) => words.replace(/\s+/g, ' ').trim().toLowerCase();
  return plain(a) === plain(b);
}
