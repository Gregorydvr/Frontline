// send(): the one way a text leaves Front-line (rule 1 in CLAUDE.md). Nothing
// else hands a text to a provider; lint fails anything that tries.
//
// Before a text goes:
// - Its words are made here, from the firm's wording agreed at set-up for its
//   kind and facts from the record. Nobody can hand send() words of their own.
//   A firm with no agreed wording for the kind gets no text (rule 2).
// - For a customer: the firm's stop button, then its switch for the kind's
//   service, then the customer's opt-out (rule 3). The stop button and the
//   switch hold the text: it is not claimed, and whoever asked can try again.
//   An opt-out, or no mobile, means it is not sent, and that is recorded, as
//   does a text that should carry a link when no link could be made.
//   An alert to the owner is not held by any of these: they are about texts
//   to customers. A text that would go to a customer in quiet hours, 8pm to
//   8am UK time, is held too, until 8am.
// - A text this row in the due list already claimed is found first, so a row
//   run again after its worker stopped finds what happened, whatever the
//   stop button says now.
// - The words must be GSM-7, and the segments are counted (rule 4).
// - The text is claimed: its row in the due list and who it is to can be
//   written once, so the same text cannot go twice (rule 3).
// Then it is handed to the provider, and what happened is recorded, with a
// history entry when it went (rule 15). An example firm's texts go to the
// stand-in for texts, never to a real provider.

import { isGsm7 } from './gsm';
import { log } from './log';
import type { Instant } from './clock';
import { makeWords, quietUntil, type Facts } from './messages';
import type { UkMobile } from './phone';
import type { Texts } from './providers/texts';
import { FakeTexts } from './providers/texts/fake';
import {
  claimMessage,
  findMessageForDue,
  firmWording,
  getCustomer,
  getFirm,
  getMessage,
  getOwner,
  isNumberOptedOut,
  listOptOuts,
  markMessageFailed,
  markMessageSent,
  optOut,
  optOutNumber,
} from './record';
import { Refused, type RecordDb } from './record/db';
import { CLAIM_HOLDS_FOR } from './record/due';
import type { NewMessage } from './record/messages';
import {
  MESSAGE_KINDS,
  type CallId,
  type DueId,
  type FirmId,
  type JobId,
  type MessageId,
  type MessageKind,
  type MessageReason,
  type MessageState,
  type Recipient,
  type VisitId,
} from './record/types';

/** Where an example firm's texts go when the copy's provider is a real one. */
const EXAMPLE_TEXTS: Texts = new FakeTexts();

export interface Outgoing {
  /** The row in the due list this text comes from. With who it is to, it is the claim. */
  due: DueId;
  kind: MessageKind;
  to: Recipient;
  about: { job: JobId | null; visit: VisitId | null; call: CallId | null };
  /** What fills the gaps in the firm's wording for the kind. */
  facts: Facts;
}

export type SendResult =
  | { result: 'sent'; message: MessageId }
  /** Not claimed. The stop button is on, or the firm's switch for the service is off. */
  | { result: 'held'; why: 'stopped' | 'service_off' }
  /** Not claimed. It would reach a customer in quiet hours; it can go from `until`. */
  | { result: 'held'; why: 'quiet_hours'; until: Instant }
  | { result: 'not_sent'; message: MessageId; why: MessageReason }
  | { result: 'failed'; message: MessageId; why: 'refused' | 'unsubscribed' | 'unclear' }
  /** Claimed before, by this row in the due list, and where it got to. Nothing more was sent. */
  | { result: 'already'; message: MessageId; state: MessageState };

export async function send(texts: Texts, db: RecordDb, firmId: FirmId, out: Outgoing): Promise<SendResult> {
  const kind = MESSAGE_KINDS[out.kind];
  const firm = await getFirm(db, firmId);
  if (firm === null || !Object.hasOwn(MESSAGE_KINDS, out.kind) || kind.to !== out.to.kind) {
    throw new Refused();
  }
  const earlier = await findMessageForDue(db, firmId, out.due, out.to);
  if (earlier !== null) {
    return already(db, firmId, earlier.id);
  }

  let toNumber: UkMobile | null;
  if (out.to.kind === 'customer') {
    // Rule 3, in this order: the stop button, the service switch, the opt-out.
    if (firm.stopped) {
      log('text_held', { firm: firmId, due: out.due });
      return { result: 'held', why: 'stopped' };
    }
    if (kind.service !== null && !firm.services[kind.service]) {
      log('text_held', { firm: firmId, due: out.due });
      return { result: 'held', why: 'service_off' };
    }
    const customer = await getCustomer(db, firmId, out.to.customer);
    if (customer === null) {
      throw new Refused();
    }
    const optedOut = await listOptOuts(db, firmId, customer.id);
    if (
      optedOut.includes('every') ||
      optedOut.some((opted) => opted === out.kind) ||
      (customer.mobile !== null && (await isNumberOptedOut(db, firmId, customer.mobile)))
    ) {
      return notSent(db, firmId, out, 'opted_out');
    }
    toNumber = customer.mobile;
  } else {
    const owner = await getOwner(db, firmId, out.to.owner);
    if (owner === null) {
      throw new Refused();
    }
    toNumber = owner.mobile;
  }
  if (toNumber === null) {
    return notSent(db, firmId, out, 'no_mobile');
  }
  if (firm.phoneNumber === null) {
    return notSent(db, firmId, out, 'no_number');
  }
  // A text that must carry its link, such as the customer's first or the
  // owner's login, when no link could be made because this copy has no
  // address for it yet.
  if (kind.linkRequired && (out.facts.link ?? null) === null) {
    return notSent(db, firmId, out, 'no_link_address');
  }
  const wording = (await firmWording(db, firmId))[`text:${out.kind}`];
  if (wording === undefined) {
    return notSent(db, firmId, out, 'no_wording');
  }
  const words = makeWords(wording.words, out.facts);
  if (words === '' || !isGsm7(words)) {
    return notSent(db, firmId, out, 'not_gsm7');
  }
  const until = out.to.kind === 'customer' ? quietUntil(db.clock.now()) : null;
  if (until !== null) {
    log('text_held', { firm: firmId, due: out.due });
    return { result: 'held', why: 'quiet_hours', until };
  }

  const claimed = await claim(db, firmId, out, {
    going: { toNumber, fromNumber: firm.phoneNumber, words, wording: wording.id },
    notSent: null,
  });
  if (claimed.already) {
    return already(db, firmId, claimed.message);
  }
  const message = claimed.message;

  // An example firm's texts never reach a real provider, on any copy: its
  // customers are invented, and moving its clock on in the control room
  // brings its reminders due. They go to the stand-in, and are recorded as
  // sent through it.
  const carrier = firm.isExample && texts.provider !== 'fake' ? EXAMPLE_TEXTS : texts;
  let answer;
  try {
    answer = await carrier.sendText({ from: firm.phoneNumber, to: toNumber, body: words });
  } catch {
    // It is not clear whether the provider took it, so it is never sent
    // again. Staff check it.
    await markMessageFailed(db, firmId, message, 'unclear', null);
    log('text_unclear', { firm: firmId, message });
    return { result: 'failed', message, why: 'unclear' };
  }
  if (!answer.ok) {
    await markMessageFailed(db, firmId, message, answer.reason, answer.code);
    log('text_failed', { firm: firmId, message });
    if (answer.reason === 'unsubscribed' && out.to.kind === 'customer') {
      // The number texted STOP to the provider itself: it, and the customer,
      // are opted out of every text here too, so our record and the
      // provider's agree.
      await optOut(db, firmId, out.to.customer, 'every', { kind: 'customer' });
      await optOutNumber(db, firmId, toNumber);
    }
    return { result: 'failed', message, why: answer.reason };
  }
  await markMessageSent(db, firmId, message, carrier.provider, answer.providerId);
  log('text_sent', { firm: firmId, message });
  return { result: 'sent', message };
}

async function notSent(db: RecordDb, firm: FirmId, out: Outgoing, why: MessageReason): Promise<SendResult> {
  const claimed = await claim(db, firm, out, { going: null, notSent: why });
  if (claimed.already) {
    return already(db, firm, claimed.message);
  }
  log('text_not_sent', { firm, message: claimed.message });
  return { result: 'not_sent', message: claimed.message, why };
}

/** Claims the text. When this row in the due list already claimed a text to this person, gives that one. */
async function claim(
  db: RecordDb,
  firm: FirmId,
  out: Outgoing,
  what: Pick<NewMessage, 'going' | 'notSent'>,
): Promise<{ already: boolean; message: MessageId }> {
  try {
    const message = await claimMessage(db, firm, { due: out.due, kind: out.kind, to: out.to, about: out.about, ...what });
    return { already: false, message };
  } catch (thrown) {
    const first = thrown instanceof Refused ? await findMessageForDue(db, firm, out.due, out.to) : null;
    if (first === null) {
      throw thrown;
    }
    return { already: true, message: first.id };
  }
}

/**
 * A text claimed before. If the worker that claimed it stopped while handing
 * it over, long enough ago that it is not still at it, nobody can tell
 * whether the provider took it: it is marked for staff to check, and never
 * sent again.
 */
async function already(db: RecordDb, firm: FirmId, message: MessageId): Promise<SendResult> {
  const found = await getMessage(db, firm, message);
  if (found === null) {
    throw new Refused();
  }
  log('text_already', { firm, message });
  if (found.state === 'sending' && found.createdAt <= db.clock.now() - CLAIM_HOLDS_FOR) {
    await markMessageFailed(db, firm, message, 'unclear', null);
    log('text_unclear', { firm, message });
    return { result: 'already', message, state: 'failed' };
  }
  return { result: 'already', message, state: found.state };
}
