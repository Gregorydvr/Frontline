// The clock (rule 20 in CLAUDE.md). Every minute, the rows of the due list
// whose time has come are put on a queue. A worker takes each one, claims it
// in one step, acts, and marks it done. A row past its latest time is skipped,
// and that is kept on the row, so nothing is ever done late.
//
// Acting twice does no harm: a row can be claimed by one worker only, and
// each text it sends is claimed again by send(), so it cannot go twice even
// when a worker stops halfway and the row is run again.
//
// What a row can do:
// - alert_owner: text the firm's owner about an urgent call, at once
// - send_confirmation: text the customer the confirmation of a visit just
//   booked, with their link if it is the first text the firm sends them
// - send_reminder: text the customer the reminder for a visit tomorrow
// - send_login_link: text an owner the link they asked for to log in

import type { Instant } from './clock';
import type { Deps } from './deps';
import { isId } from './ids';
import { clockWords } from './history-lines';
import { inLondon, londonDay, MONTHS, WEEKDAYS } from './london';
import { VISIT_PURPOSES } from './messages';
import { errorName, log } from './log';
import { nationalNumber } from './phone';
import {
  claimDue,
  findDue,
  finishDue,
  getCall,
  getCustomer,
  getFirm,
  getJob,
  getVisit,
  getOwner,
  hasTextedCustomer,
  linkForDue,
  listOwners,
  loginLinkForDue,
  releaseDue,
} from './record';
import { openRecord, type RecordDb } from './record/db';
import type { ClaimedDue, DueId, DueOutcome, FirmId } from './record/types';
import { send, type SendResult } from './send';

/** What running a row needs from outside: the texts provider, and where customers' links and the owner's app are. */
export type DueDeps = Pick<Deps, 'texts'> & Partial<Pick<Deps, 'linkAddress' | 'appAddress'>>;

/** What goes on the queue for each row: ids only. */
export interface DueMessage {
  firm: FirmId;
  due: DueId;
}

/** The queue the clock puts due rows on. Cloudflare's queue in the Worker; a pretend one in tests. */
export interface DueQueue {
  sendBatch(messages: Iterable<{ body: DueMessage }>): Promise<unknown>;
}

/** What one run of a row came to. */
export type Ran =
  | { ran: 'done' | 'skipped'; outcome: DueOutcome }
  /** Put back to wait, such as a text to a customer while the stop button is on. */
  | { ran: 'held' }
  /** Another worker has it, or it is finished, cancelled or not yet due. Nothing was done. */
  | { ran: 'not_ours' };

/** Every minute: puts the rows that are due, for every firm, on the queue. Gives how many. */
export async function everyMinute(d1: D1Database, deps: Deps): Promise<number> {
  const due = await findDue(openRecord(d1, deps.clock));
  // A queue takes at most 100 messages at once.
  for (let start = 0; start < due.length; start += 100) {
    await deps.queue.sendBatch(due.slice(start, start + 100).map((body) => ({ body })));
  }
  if (due.length > 0) {
    log('due_queued', { rows: due.length });
  }
  return due.length;
}

/**
 * The queue's worker. Each message is one row to run. A row that fails is
 * logged and left claimed; the clock offers it again once its claim runs
 * out, so the queue does not need to try it again.
 */
export async function onQueue(batch: MessageBatch, d1: D1Database, deps: Deps): Promise<void> {
  for (const message of batch.messages) {
    const body = dueMessage(message.body);
    if (body !== null) {
      try {
        await runDue(openRecord(d1, deps.clock), deps, body.firm, body.due);
      } catch (thrown) {
        log('due_failed', { firm: body.firm, due: body.due, error: errorName(thrown) });
      }
    } else {
      log('due_unreadable');
    }
    message.ack();
  }
}

/** Runs one of the firm's rows: claims it, acts, and marks it done, skipped or back to wait. */
export async function runDue(db: RecordDb, deps: DueDeps, firm: FirmId, due: DueId): Promise<Ran> {
  const row = await claimDue(db, firm, due);
  if (row === null) {
    return { ran: 'not_ours' };
  }
  if (db.clock.now() > row.latestAt) {
    await finishDue(db, firm, due, row.claim, 'too_late');
    log('due_too_late', { firm, due });
    return { ran: 'skipped', outcome: 'too_late' };
  }

  const outcome = await act(db, deps, firm, row);
  if (typeof outcome === 'object') {
    // Held: back to wait, or, after quiet hours, until 8am. A row whose
    // latest time comes before then is skipped now.
    if (outcome.until !== null && outcome.until > row.latestAt) {
      await finishDue(db, firm, due, row.claim, 'too_late');
      log('due_too_late', { firm, due });
      return { ran: 'skipped', outcome: 'too_late' };
    }
    await releaseDue(db, firm, due, row.claim, outcome.until);
    return { ran: 'held' };
  }
  if (!(await finishDue(db, firm, due, row.claim, outcome))) {
    // Its claim ran out and another worker took it. What this one did is
    // recorded on its texts, which cannot go twice.
    log('due_claim_lost', { firm, due });
  }
  return { ran: 'done', outcome };
}

/** A row whose text cannot go yet: it waits, until a given time or to be offered again. */
interface Held {
  until: Instant | null;
}

async function act(db: RecordDb, deps: DueDeps, firm: FirmId, row: ClaimedDue): Promise<DueOutcome | Held> {
  switch (row.action) {
    case 'alert_owner':
      return alertOwner(db, deps, firm, row);
    case 'send_confirmation':
      return sendConfirmation(db, deps, firm, row);
    case 'send_reminder':
      return sendReminder(db, deps, firm, row);
    case 'send_login_link':
      return sendLoginLink(db, deps, firm, row);
  }
}

/**
 * Texts an owner the link they asked for to log in, to the mobile on their
 * record. While this copy has no address for the app, no link can be made,
 * and the text is not sent: the record says why.
 */
async function sendLoginLink(db: RecordDb, deps: DueDeps, firm: FirmId, row: ClaimedDue): Promise<DueOutcome> {
  const link = await loginLinkForDue(db, firm, row.id);
  const owner = link === null ? null : await getOwner(db, firm, link.owner);
  if (link === null || owner === null) {
    log('login_link_nobody', { firm, due: row.id });
    return 'nobody_to_tell';
  }
  const address = deps.appAddress ?? null;
  const result = await send(deps.texts, db, firm, {
    due: row.id,
    kind: 'login_link',
    to: { kind: 'owner', owner: owner.id },
    about: { job: null, visit: null, call: null },
    facts: { link: address === null ? null : `${address}/in/${link.token}` },
  });
  return outcomeOf([result]);
}

/**
 * Texts each of the firm's owners about an urgent call: who rang, where,
 * what about, their number, and a link to the job once this copy has an
 * address for the app. Once one has gone, the job's history says it was
 * passed straight to the owner. A call whose caller's details did not
 * all come through has no customer or job to name, so it gets the other
 * wording, with what there is.
 */
async function alertOwner(db: RecordDb, deps: DueDeps, firm: FirmId, row: ClaimedDue): Promise<DueOutcome> {
  const call = row.call === null ? null : await getCall(db, firm, row.call);
  const job = call === null || call.job === null ? null : await getJob(db, firm, call.job);
  const owners = await listOwners(db, firm);
  if (call === null || owners.length === 0) {
    log('alert_nobody_to_tell', { firm, due: row.id });
    return 'nobody_to_tell';
  }
  const number = call.from === null ? 'withheld' : nationalNumber(call.from);
  const summary = asSentence(call.summary);
  const address = deps.appAddress ?? null;
  const link = address === null || job === null ? null : `${address}/jobs/${job.id}`;
  const results: SendResult[] = [];
  for (const owner of owners) {
    const to = { kind: 'owner', owner: owner.id } as const;
    results.push(
      await send(
        deps.texts,
        db,
        firm,
        job === null || call.customer === null
          ? {
              due: row.id,
              kind: 'urgent_alert_details_missing',
              to,
              about: { job: null, visit: null, call: call.id },
              facts: { summary, number },
            }
          : {
              due: row.id,
              kind: 'urgent_alert',
              to,
              about: { job: job.id, visit: null, call: call.id },
              facts: { customer: call.customer.name, place: job.place, summary, number, link },
            },
      ),
    );
  }
  return outcomeOf(results);
}

/** The one line about a call, ending as a sentence ends, so the words after it read on. */
function asSentence(summary: string | null): string | null {
  return summary === null || /[.!?]$/.test(summary) ? summary : `${summary}.`;
}

/**
 * Texts the customer the reminder for a visit tomorrow. The visit is looked
 * at again first: if it was cancelled, or is no longer tomorrow in UK time
 * (the reminder says "tomorrow"), nothing goes.
 */
async function sendReminder(
  db: RecordDb,
  deps: DueDeps,
  firm: FirmId,
  row: ClaimedDue,
): Promise<DueOutcome | Held> {
  const visit = row.visit === null ? null : await getVisit(db, firm, row.visit);
  if (visit?.state !== 'booked' || londonDay(visit.startsAt) - londonDay(db.clock.now()) !== 1) {
    log('reminder_visit_changed', { firm, due: row.id });
    return 'visit_changed';
  }
  const job = await getJob(db, firm, visit.job);
  const customer = job === null ? null : await getCustomer(db, firm, job.customer);
  const firmName = (await getFirm(db, firm))?.name ?? null;
  if (job === null || customer === null || firmName === null) {
    return 'visit_changed';
  }
  const [owner] = await listOwners(db, firm);
  const at = inLondon(visit.startsAt);
  const result = await send(deps.texts, db, firm, {
    due: row.id,
    kind: 'visit_reminder',
    to: { kind: 'customer', customer: customer.id },
    about: { job: job.id, visit: visit.id, call: null },
    facts: {
      owner: owner?.name ?? firmName,
      weekday: WEEKDAYS[at.weekday] ?? null,
      time: clockWords(at.hour, at.minute),
    },
  });
  if (result.result === 'held') {
    return { until: result.why === 'quiet_hours' ? result.until : null };
  }
  return outcomeOf([result]);
}

/**
 * Texts the customer the confirmation of a visit just booked. The visit is
 * looked at again first: if it was cancelled, nothing goes; if it moved, the
 * confirmation gives its new time. If the firm has never texted this
 * customer, it is the first text, with their link to confirm their details
 * and the line on opting out. The same row run again gives the same link.
 */
async function sendConfirmation(db: RecordDb, deps: DueDeps, firm: FirmId, row: ClaimedDue): Promise<DueOutcome | Held> {
  const visit = row.visit === null ? null : await getVisit(db, firm, row.visit);
  if (visit?.state !== 'booked') {
    log('confirmation_visit_changed', { firm, due: row.id });
    return 'visit_changed';
  }
  const job = await getJob(db, firm, visit.job);
  const customer = job === null ? null : await getCustomer(db, firm, job.customer);
  const firmNow = await getFirm(db, firm);
  if (job === null || customer === null || firmNow === null) {
    return 'visit_changed';
  }
  const [owner] = await listOwners(db, firm);
  const first = !(await hasTextedCustomer(db, firm, customer.id));
  let link: string | null = null;
  const address = deps.linkAddress ?? null;
  if (first && customer.mobile !== null && address !== null) {
    const token = await linkForDue(db, firm, { due: row.id, customer: customer.id, job: job.id });
    link = `${address}/d/${token}`;
  }
  const at = inLondon(visit.startsAt);
  const facts = {
    customer: customer.name,
    firm: firmNow.name,
    owner: owner?.name ?? firmNow.name,
    day: `${WEEKDAYS[at.weekday] ?? ''} ${String(at.day)} ${MONTHS[at.month - 1] ?? ''}`,
    time: clockWords(at.hour, at.minute),
    purpose: VISIT_PURPOSES[visit.kind],
  };
  const result = await send(deps.texts, db, firm, {
    due: row.id,
    kind: first ? 'visit_confirmation_first' : 'visit_confirmation',
    to: { kind: 'customer', customer: customer.id },
    about: { job: job.id, visit: visit.id, call: null },
    facts: first ? { ...facts, link } : facts,
  });
  if (result.result === 'held') {
    return { until: result.why === 'quiet_hours' ? result.until : null };
  }
  return outcomeOf([result]);
}

/** How a row's texts came out: sent if any went, failed if any failed, otherwise not sent. */
function outcomeOf(results: SendResult[]): DueOutcome {
  const states = results.map((result) => {
    if (result.result !== 'already') return result.result;
    // Claimed by an earlier run of this row: where that text got to.
    return result.state === 'sending' || result.state === 'delivered' ? 'sent' : result.state;
  });
  if (states.includes('sent')) return 'sent';
  if (states.includes('failed')) return 'failed';
  return 'not_sent';
}

function dueMessage(body: unknown): DueMessage | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }
  const { firm, due } = body as Record<string, unknown>;
  return isId(firm) && isId(due) ? { firm: firm as FirmId, due: due as DueId } : null;
}
