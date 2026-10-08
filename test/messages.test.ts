// The words of each kind of text (rule 4 in CLAUDE.md): every draft, and the
// demo firm's agreed wording, uses GSM-7 characters only. A curly apostrophe
// in any of them fails this test, and so the check.

import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { instantFromIso, pretendClock } from '../src/clock';
import { loadExample } from '../src/example/load';
import { isGsm7, notGsm7, segments } from '../src/gsm';
import { DRAFT_WORDING, makeWords } from '../src/messages';
import { ukMobile } from '../src/phone';
import {
  createCustomer,
  firmWording,
  getOwner,
  listOptOuts,
  listOwners,
  optIn,
  optOut,
  setOwnerMobile,
  setWording,
} from '../src/record';
import { openRecord, Refused } from '../src/record/db';
import { MESSAGE_KINDS, type MessageKind } from '../src/record/types';
import { gapsIn } from '../src/record/wording';
import { historyKinds } from './helpers/db';
import { tidewell } from './helpers/vapi';

const clock = pretendClock(instantFromIso('2026-10-15T16:00:00+01:00'));
const db = openRecord(env.DB, clock);
const frontline = { kind: 'frontline' } as const;

describe('the drafts', () => {
  it('cover every kind of text, using only the gaps each kind has', () => {
    expect(Object.keys(DRAFT_WORDING).sort()).toEqual(Object.keys(MESSAGE_KINDS).sort());
    for (const [kind, draft] of Object.entries(DRAFT_WORDING)) {
      for (const gap of gapsIn(draft ?? '')) {
        expect(MESSAGE_KINDS[kind as MessageKind].gaps).toContain(gap);
      }
    }
  });

  it('use GSM-7 characters only: straight quotes, no emoji', () => {
    for (const [kind, draft] of Object.entries(DRAFT_WORDING)) {
      expect(notGsm7(draft ?? ''), kind).toEqual([]);
    }
  });

  it('leave the owner’s urgent alert as a named gap until its words are agreed (open question 7)', () => {
    expect(DRAFT_WORDING.urgent_alert).toBeNull();
  });

  it('make the reminder in the brief, with a straight apostrophe, in one segment', () => {
    const words = makeWords(DRAFT_WORDING.visit_reminder ?? '', { owner: 'Tom', weekday: 'Thursday', time: '3pm' });
    expect(words).toBe("Reminder: Tom's visit is tomorrow, Thursday, at 3pm. See you then.");
    expect(segments(words)).toBe(1);
  });
});

describe('the demo firm’s agreed wording', () => {
  it('is the drafts, for every kind that has one, all GSM-7', async () => {
    const firm = await loadExample(env.DB);
    const words = await firmWording(db, firm);
    expect(words['text:visit_reminder']?.words).toBe(DRAFT_WORDING.visit_reminder);
    expect(words['text:urgent_alert']).toBeUndefined();
    for (const { words: agreed } of Object.values(words)) {
      expect(isGsm7(agreed)).toBe(true);
    }
    // Tom has a mobile for his alerts.
    const [tom] = await listOwners(db, firm);
    expect(tom).toMatchObject({ name: 'Tom', mobile: '+447700900101' });
  });
});

describe('makeWords', () => {
  it('fills each gap with the fact for it', () => {
    expect(makeWords('Hi {customer}, see you at {time}.', { customer: 'Mrs Green', time: '9am' })).toBe('Hi Mrs Green, see you at 9am.');
  });

  it('leaves no doubled space behind a gap with no fact', () => {
    expect(makeWords('Urgent call from {customer}. {summary} Their number: {number}.', { customer: 'Mr Price', summary: null, number: 'withheld' })).toBe(
      'Urgent call from Mr Price. Their number: withheld.',
    );
  });

  it('makes a fact fit for a text, and keeps it on one line, but never changes the firm’s own words', () => {
    expect(makeWords('Hi {customer}.', { customer: 'Mrs O’Brien\nof “Flat 2”' })).toBe("Hi Mrs O'Brien of \"Flat 2\".");
    expect(makeWords('Hi {customer}.', { customer: 'Mr Łukasz' })).toBe('Hi Mr ?ukasz.');
  });

  it('refuses words with a gap it has no fact for', () => {
    expect(() => makeWords('Hi {customer}.', {})).toThrow(RangeError);
  });
});

describe('setWording', () => {
  it('keeps every version, and the newest is in use', async () => {
    const firm = await tidewell(db, '+447700903001');
    const first = await setWording(db, firm, 'text:visit_reminder', 'Reminder: {time}.', frontline);
    clock.advance(60_000);
    const second = await setWording(db, firm, 'text:visit_reminder', 'Reminder: see you at {time}.', frontline);
    expect(first).not.toBe(second);
    expect((await firmWording(db, firm))['text:visit_reminder']).toEqual({ id: second, words: 'Reminder: see you at {time}.' });
  });

  it('takes the firm’s own words for an owner’s line, which keep the app’s curly apostrophe', async () => {
    const firm = await tidewell(db, '+447700903002');
    await setWording(db, firm, 'line:confirmation_sent:feed', 'Confirmed {customer’s} visit.', frontline);
    expect((await firmWording(db, firm))['line:confirmation_sent:feed']?.words).toBe('Confirmed {customer’s} visit.');
    await expect(setWording(db, firm, 'line:confirmation_sent:feed', 'Confirmed {time}.', frontline)).rejects.toThrow(Refused);
    await expect(setWording(db, firm, 'line:nothing:feed' as never, 'Confirmed.', frontline)).rejects.toThrow(Refused);
    await expect(setWording(db, firm, 'line:confirmation_sent:page' as never, 'Confirmed.', frontline)).rejects.toThrow(Refused);
    await expect(setWording(db, firm, 'line:confirmation_sent:job', 'Two\nlines.', frontline)).rejects.toThrow(Refused);
  });

  it('cannot be done by a customer', async () => {
    const firm = await tidewell(db, '+447700903003');
    await expect(setWording(db, firm, 'text:visit_reminder', 'Reminder: {time}.', { kind: 'customer' })).rejects.toThrow(Refused);
  });
});

describe('opt-outs', () => {
  it('are held for each kind of text, or every kind, and each change is recorded', async () => {
    const firm = await tidewell(db, '+447700903004');
    const mrsAhmed = await createCustomer(db, firm, { name: 'Mrs Ahmed', mobile: ukMobile('07700 900003') });
    await optOut(db, firm, mrsAhmed, 'visit_reminder', frontline);
    await optOut(db, firm, mrsAhmed, 'visit_reminder', frontline);
    expect(await listOptOuts(db, firm, mrsAhmed)).toEqual(['visit_reminder']);
    await optOut(db, firm, mrsAhmed, 'every', { kind: 'customer' });
    expect(await listOptOuts(db, firm, mrsAhmed)).toEqual(['every', 'visit_reminder']);
    await optIn(db, firm, mrsAhmed, 'visit_reminder', frontline);
    expect(await listOptOuts(db, firm, mrsAhmed)).toEqual(['every']);
    await optOut(db, firm, mrsAhmed, 'visit_reminder', frontline);
    await optIn(db, firm, mrsAhmed, 'every', frontline);
    expect(await listOptOuts(db, firm, mrsAhmed)).toEqual([]);
    expect(await historyKinds(env.DB, firm)).toMatchObject({ opted_out: 4, opted_in: 2 });
  });

  it('refuse a kind of text that is not to customers, or not on the list', async () => {
    const firm = await tidewell(db, '+447700903005');
    const mrsAhmed = await createCustomer(db, firm, { name: 'Mrs Ahmed', mobile: ukMobile('07700 900003') });
    await expect(optOut(db, firm, mrsAhmed, 'urgent_alert' as never, frontline)).rejects.toThrow(Refused);
    await expect(optOut(db, firm, mrsAhmed, 'marketing' as never, frontline)).rejects.toThrow(Refused);
    expect(await listOptOuts(db, firm, mrsAhmed)).toEqual([]);
  });
});

describe('the owner’s mobile', () => {
  it('is set and cleared, and each change is recorded', async () => {
    const firm = await tidewell(db, '+447700903006');
    const [tom] = await listOwners(db, firm);
    if (tom === undefined) throw new Error('No owner');
    await setOwnerMobile(db, firm, tom.id, null, frontline);
    expect((await getOwner(db, firm, tom.id))?.mobile).toBeNull();
    await setOwnerMobile(db, firm, tom.id, ukMobile('07700 900102'), frontline);
    expect((await getOwner(db, firm, tom.id))?.mobile).toBe('+447700900102');
    expect(await historyKinds(env.DB, firm)).toMatchObject({ owner_mobile_set: 2 });
    await expect(setOwnerMobile(db, firm, tom.id, '07700 900102' as never, frontline)).rejects.toThrow(Refused);
  });
});
