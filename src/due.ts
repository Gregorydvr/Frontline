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
// - send_reminder: text the customer the reminder for a visit tomorrow

import type { Deps } from './deps';
import { isId } from './ids';
import { clockWords } from './history-lines';
import { inLondon, londonDay, WEEKDAYS } from './london';
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
  listOwners,
  releaseDue,
} from './record';
import { openRecord, type RecordDb } from './record/db';
import type { ClaimedDue, DueId, DueOutcome, FirmId } from './record/types';
import { send, type SendResult } from './send';

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
export async function runDue(db: RecordDb, deps: Pick<Deps, 'texts'>, firm: FirmId, due: DueId): Promise<Ran> {
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
  if (outcome === 'held') {
    await releaseDue(db, firm, due, row.claim);
    return { ran: 'held' };
  }
  if (!(await finishDue(db, firm, due, row.claim, outcome))) {
    // Its claim ran out and another worker took it. What this one did is
    // recorded on its texts, which cannot go twice.
    log('due_claim_lost', { firm, due });
  }
  return { ran: 'done', outcome };
}

async function act(db: RecordDb, deps: Pick<Deps, 'texts'>, firm: FirmId, row: ClaimedDue): Promise<DueOutcome | 'held'> {
  switch (row.action) {
    case 'alert_owner':
      return alertOwner(db, deps, firm, row);
    case 'send_reminder':
      return sendReminder(db, deps, firm, row);
  }
}

/**
 * Texts each of the firm's owners about an urgent call: who rang, where,
 * what about, and their number. Once one has gone, the job's history says it
 * was passed straight to the owner.
 */
async function alertOwner(db: RecordDb, deps: Pick<Deps, 'texts'>, firm: FirmId, row: ClaimedDue): Promise<DueOutcome> {
  const call = row.call === null ? null : await getCall(db, firm, row.call);
  const job = call === null || call.job === null ? null : await getJob(db, firm, call.job);
  const owners = await listOwners(db, firm);
  if (call === null || job === null || call.customer === null || owners.length === 0) {
    log('alert_nobody_to_tell', { firm, due: row.id });
    return 'nobody_to_tell';
  }
  const results: SendResult[] = [];
  for (const owner of owners) {
    results.push(
      await send(deps.texts, db, firm, {
        due: row.id,
        kind: 'urgent_alert',
        to: { kind: 'owner', owner: owner.id },
        about: { job: job.id, visit: null, call: call.id },
        facts: {
          customer: call.customer.name,
          place: job.place,
          summary: call.summary,
          number: call.from === null ? 'withheld' : nationalNumber(call.from),
        },
      }),
    );
  }
  return outcomeOf(results);
}

/**
 * Texts the customer the reminder for a visit tomorrow. The visit is looked
 * at again first: if it was cancelled, or is no longer tomorrow in UK time
 * (the reminder says "tomorrow"), nothing goes.
 */
async function sendReminder(
  db: RecordDb,
  deps: Pick<Deps, 'texts'>,
  firm: FirmId,
  row: ClaimedDue,
): Promise<DueOutcome | 'held'> {
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
  return result.result === 'held' ? 'held' : outcomeOf([result]);
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
