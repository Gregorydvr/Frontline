// Calls: one row for each call a firm's number takes, whoever rang. A call
// is held once, however many times its report arrives, and everything that
// comes with it (the customer, the job and the history) is written in the
// same step, so either all of it is kept or none of it is.

import { instant, type Instant } from '../clock';
import { newId } from '../ids';
import { isUkLandline, isUkMobile, type UkLandline, type UkMobile } from '../phone';
import { insertCustomer } from './customers';
import { line, Refused, run, runTogether, type RecordDb } from './db';
import { insertDue } from './due';
import { callEntry, historyStatement } from './history';
import { fileHold } from './holds';
import { insertJob } from './jobs';
import { insertVisit } from './visits';
import {
  CALL_LIMITS,
  CALL_PROVIDERS,
  type Call,
  type CallId,
  type CallOutcome,
  type CallProvider,
  type CustomerId,
  type DueId,
  type FirmId,
  type JobId,
  type NewCall,
  type VisitId,
  type VisitKind,
} from './types';

const frontline = { kind: 'frontline' } as const;

/**
 * How long the owner's alert about an urgent call stays worth sending, if it
 * cannot go at once: a day. Past that it is skipped, and that is recorded.
 */
export const ALERT_LATEST_AFTER = 24 * 3_600_000;

export interface RecordedCall {
  call: CallId;
  customer: CustomerId | null;
  job: JobId | null;
  /** For an urgent call, the row in the due list that alerts the owner. */
  alert: DueId | null;
  /** For a call with a visit booked on it, the visit and its rows in the due list. */
  visit: VisitId | null;
  dues: DueId[];
}

/**
 * Records a call that this firm's number took, with what comes with it:
 * - for a new caller, the customer and their job, the call answered and
 *   their details taken
 * - for one of the firm's customers, a new job and the call answered
 * - for someone who is not a customer, a message taken
 * - for a call whose details are missing, just that
 * A call with an urgent item is urgent, and so is its job, and a row in the
 * due list to alert the owner at once is written with it. A customer's call
 * that is not urgent can come with a booking: the time held during the call
 * becomes a visit on its job, the call is booked, and the visit's
 * confirmation and reminder go in the due list. A call the record already
 * holds is refused, and nothing is written.
 */
export async function recordCall(db: RecordDb, firm: FirmId, input: NewCall): Promise<RecordedCall> {
  if (!CALL_PROVIDERS.includes(input.provider)) {
    throw new Refused();
  }
  line(input.providerCallId, CALL_LIMITS.providerCallId);
  if (input.from !== null && !isUkMobile(input.from) && !isUkLandline(input.from)) {
    throw new Refused();
  }
  const urgentItem = input.urgentItem === null ? null : line(input.urgentItem, CALL_LIMITS.urgentItem);
  const summary = input.summary === null ? null : line(input.summary, CALL_LIMITS.summary);
  if (input.transcript !== null && input.transcript.length > CALL_LIMITS.transcript) {
    throw new Refused();
  }
  const booking = input.booking ?? null;
  if (booking !== null && (urgentItem !== null || (input.for.kind !== 'new_customer' && input.for.kind !== 'customer'))) {
    throw new Refused();
  }
  const outcome: CallOutcome = urgentItem !== null ? 'urgent' : booking !== null ? 'booked' : 'message';

  const call = newId() as CallId;
  let customer: CustomerId | null = null;
  let job: JobId | null = null;
  let caller: string | null = null;
  const before: D1PreparedStatement[] = [];
  const after: D1PreparedStatement[] = [];

  switch (input.for.kind) {
    case 'new_customer': {
      const { name, mobile, landline, noText, about, place } = input.for;
      customer = newId() as CustomerId;
      job = newId() as JobId;
      before.push(
        insertCustomer(db, firm, customer, { name: line(name, CALL_LIMITS.name), mobile, landline, noText, address: line(place, CALL_LIMITS.place) }),
        insertJob(db, firm, job, newJob(customer, about, place, urgentItem)),
      );
      after.push(
        callEntry(db, firm, 'call_answered', frontline, { customer, job, call }),
        callEntry(db, firm, 'details_taken', frontline, { customer, job: null, call: null }),
      );
      break;
    }
    case 'customer': {
      const { about, place } = input.for;
      customer = input.for.customer;
      job = newId() as JobId;
      before.push(insertJob(db, firm, job, newJob(customer, about, place, urgentItem)));
      after.push(callEntry(db, firm, 'call_answered', frontline, { customer, job, call }));
      break;
    }
    case 'not_customer':
      caller = line(input.for.caller, CALL_LIMITS.caller);
      after.push(callEntry(db, firm, 'message_taken', frontline, { customer: null, job: null, call }));
      break;
    case 'details_missing':
      after.push(callEntry(db, firm, 'details_missing', frontline, { customer: null, job: null, call }));
      break;
    default:
      throw new Refused();
  }

  // The booking: the held time becomes a visit on the call's job, with its
  // rows in the due list, all in the same step as the call.
  let visit: VisitId | null = null;
  const dues: DueId[] = [];
  if (booking !== null && job !== null) {
    visit = newId() as VisitId;
    before.push(
      insertVisit(db, firm, visit, { job, startsAt: booking.startsAt, endsAt: booking.endsAt, kind: booking.kind }, booking.hold),
    );
    after.push(historyStatement(db, firm, { kind: 'visit_booked', by: frontline, visit })[1], fileHold(db, firm, booking.hold, visit));
    for (const due of booking.dues) {
      // Only a visit's own rows, since types can be got round.
      if (!(['send_confirmation', 'send_reminder'] as readonly string[]).includes(due.action)) {
        throw new Refused();
      }
      const id = newId() as DueId;
      dues.push(id);
      after.push(insertDue(db, firm, id, { action: due.action, visit, runAt: due.runAt, latestAt: due.latestAt }));
    }
  }

  const insertCall = db.d1
    .prepare(
      `INSERT INTO calls (id, firm_id, provider, provider_call_id, started_at, ended_at, from_number,
                          customer_id, job_id, visit_id, outcome, urgent_item, caller, summary,
                          transcript, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      call,
      firm,
      input.provider,
      input.providerCallId,
      instant(input.startedAt),
      input.endedAt === null ? null : instant(input.endedAt),
      input.from,
      customer,
      job,
      visit,
      outcome,
      urgentItem,
      caller,
      summary,
      input.transcript,
      db.clock.now(),
    );

  // The owner hears of every urgent call, including one whose details did
  // not all come through. The row is written in the same step as the call,
  // so either both are kept or neither is.
  let alert: DueId | null = null;
  if (urgentItem !== null) {
    alert = newId() as DueId;
    const now = db.clock.now();
    after.push(insertDue(db, firm, alert, { action: 'alert_owner', call, runAt: now, latestAt: instant(now + ALERT_LATEST_AFTER) }));
  }

  // A hold that is not this firm's, or no longer held, makes no visit, so
  // the call's link to it is refused, and nothing is written.
  await runTogether(db.d1, [...before, insertCall, ...after]);
  return { call, customer, job, alert, visit, dues };
}

function newJob(customer: CustomerId, about: string, place: string, urgentItem: string | null) {
  return {
    customer,
    about: line(about, CALL_LIMITS.about),
    place: line(place, CALL_LIMITS.place),
    urgent: urgentItem !== null,
  };
}

/** The call this firm holds under the provider's own id for it, if any. */
export async function findCallByProviderId(
  db: RecordDb,
  firm: FirmId,
  provider: CallProvider,
  providerCallId: string,
): Promise<CallId | null> {
  const row = await db.d1
    .prepare('SELECT id FROM calls WHERE firm_id = ? AND provider = ? AND provider_call_id = ?')
    .bind(firm, provider, providerCallId)
    .first<{ id: string }>();
  return row === null ? null : (row.id as CallId);
}

/** One call, with its transcript. */
export async function getCall(
  db: RecordDb,
  firm: FirmId,
  call: CallId,
): Promise<(Call & { transcript: string | null }) | null> {
  const row = await db.d1
    .prepare(`${SELECT_CALL}, k.transcript ${FROM_CALLS} WHERE k.firm_id = ? AND k.id = ?`)
    .bind(firm, call)
    .first<CallRow & { transcript: string | null }>();
  return row === null ? null : { ...fromRow(row), transcript: row.transcript };
}

/** The firm's calls that started from one instant up to, not including, another, in the order they came in. */
export async function listCallsBetween(db: RecordDb, firm: FirmId, from: Instant, to: Instant): Promise<Call[]> {
  const { results } = await db.d1
    .prepare(`${SELECT_CALL} ${FROM_CALLS} WHERE k.firm_id = ? AND k.started_at >= ? AND k.started_at < ? ORDER BY k.started_at, k.id`)
    .bind(firm, instant(from), instant(to))
    .all<CallRow>();
  return results.map(fromRow);
}

/**
 * Marks a call as booked, with the visit booked on it. The visit must be a
 * booked visit for the call's own job, and the call must be one that took a
 * message, not an urgent one.
 */
export async function markCallBooked(db: RecordDb, firm: FirmId, call: CallId, visit: VisitId): Promise<void> {
  const result = await run(
    db.d1
      .prepare(
        `UPDATE calls SET outcome = 'booked', visit_id = ?3
         WHERE firm_id = ?1 AND id = ?2 AND outcome = 'message'
           AND job_id = (SELECT job_id FROM visits WHERE firm_id = ?1 AND id = ?3 AND state = 'booked')`,
      )
      .bind(firm, call, visit),
  );
  if (result.meta.changes !== 1) {
    throw new Refused();
  }
}

const SELECT_CALL = `
  SELECT k.id, k.provider, k.provider_call_id, k.started_at, k.ended_at, k.from_number,
         k.customer_id, c.name AS customer_name, k.job_id, k.visit_id, v.kind AS visit_kind,
         v.starts_at AS visit_starts_at, k.outcome, k.urgent_item, k.caller, k.summary, k.created_at`;

const FROM_CALLS = `
  FROM calls k
  LEFT JOIN customers c ON c.firm_id = k.firm_id AND c.id = k.customer_id
  LEFT JOIN visits v ON v.firm_id = k.firm_id AND v.id = k.visit_id`;

interface CallRow {
  id: string;
  provider: CallProvider;
  provider_call_id: string;
  started_at: number;
  ended_at: number | null;
  from_number: string | null;
  customer_id: string | null;
  customer_name: string | null;
  job_id: string | null;
  visit_id: string | null;
  visit_kind: VisitKind | null;
  visit_starts_at: number | null;
  outcome: CallOutcome;
  urgent_item: string | null;
  caller: string | null;
  summary: string | null;
  created_at: number;
}

function fromRow(row: CallRow): Call {
  return {
    id: row.id as CallId,
    provider: row.provider,
    providerCallId: row.provider_call_id,
    startedAt: instant(row.started_at),
    endedAt: row.ended_at === null ? null : instant(row.ended_at),
    from: row.from_number as UkMobile | UkLandline | null,
    customer:
      row.customer_id === null || row.customer_name === null
        ? null
        : { id: row.customer_id as CustomerId, name: row.customer_name },
    job: row.job_id as JobId | null,
    visit:
      row.visit_id === null || row.visit_kind === null || row.visit_starts_at === null
        ? null
        : { id: row.visit_id as VisitId, kind: row.visit_kind, startsAt: instant(row.visit_starts_at) },
    outcome: row.outcome,
    urgentItem: row.urgent_item,
    caller: row.caller,
    summary: row.summary,
    createdAt: instant(row.created_at),
  };
}
