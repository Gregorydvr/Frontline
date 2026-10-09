// The words of each kind of text (rule 4 in CLAUDE.md): every draft, and the
// demo firm's agreed wording, uses GSM-7 characters only. A curly apostrophe
// in any of them fails this test, and so the check.

import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { instantFromIso, pretendClock } from '../src/clock';
import { loadExample } from '../src/example/load';
import { isGsm7, notGsm7, segments } from '../src/gsm';
import { DRAFT_WORDING, makeWords, quietUntil, stopOrStart } from '../src/messages';
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
import { gapsIn, wordingProblems } from '../src/set-up';
import { historyKinds } from './helpers/db';
import { tidewell } from './helpers/vapi';
import { agreedByOwner } from './helpers/owner';

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

  it('each pass the check staff save a firm’s wording through, for their own kind (slice H2)', () => {
    for (const kind of Object.keys(MESSAGE_KINDS) as MessageKind[]) {
      expect(wordingProblems(`text:${kind}`, DRAFT_WORDING[kind] ?? ''), kind).toEqual([]);
    }
  });

  it('use GSM-7 characters only: straight quotes, no emoji', () => {
    for (const [kind, draft] of Object.entries(DRAFT_WORDING)) {
      expect(notGsm7(draft ?? ''), kind).toEqual([]);
    }
  });

  it('make the owner’s urgent alert in Greg’s words, in one segment, while there is no link (open question 7)', () => {
    const facts = { customer: 'Mr Price', place: '6 Bridge Street', summary: 'A leak under the kitchen sink.', number: '07700 900016' };
    const words = makeWords(DRAFT_WORDING.urgent_alert ?? '', { ...facts, link: null });
    expect(words).toBe('Front-line: urgent call from Mr Price, 6 Bridge Street. A leak under the kitchen sink. Their number: 07700 900016.');
    expect(segments(words)).toBe(1);
    // With the link to the job, last and with no words of its own: two segments.
    const linked = makeWords(DRAFT_WORDING.urgent_alert ?? '', { ...facts, link: `https://app.example.co.uk/jobs/${'a'.repeat(26)}` });
    expect(linked).toBe(`${words} https://app.example.co.uk/jobs/${'a'.repeat(26)}`);
    expect(segments(linked)).toBe(2);
    const missing = makeWords(DRAFT_WORDING.urgent_alert_details_missing ?? '', { summary: null, number: 'withheld' });
    expect(missing).toBe('Front-line: urgent call. Not all their details came through. Their number: withheld.');
  });

  it('have words for every kind of text', () => {
    for (const [kind, draft] of Object.entries(DRAFT_WORDING)) {
      expect(draft, kind).not.toBeNull();
    }
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
    for (const kind of Object.keys(MESSAGE_KINDS) as MessageKind[]) {
      expect(words[`text:${kind}`]?.words, kind).toBe(DRAFT_WORDING[kind]);
    }
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
    const first = await setWording(db, firm, 'text:visit_reminder', 'Reminder: {time}.', frontline, await agreedByOwner(db, firm));
    clock.advance(60_000);
    const second = await setWording(db, firm, 'text:visit_reminder', 'Reminder: see you at {time}.', frontline, await agreedByOwner(db, firm));
    expect(first).not.toBe(second);
    expect((await firmWording(db, firm))['text:visit_reminder']).toEqual({ id: second, words: 'Reminder: see you at {time}.' });
  });

  it('takes the firm’s own words for an owner’s line, which keep the app’s curly apostrophe', async () => {
    const firm = await tidewell(db, '+447700903002');
    await setWording(db, firm, 'line:confirmation_sent:feed', 'Confirmed {customer’s} visit.', frontline, null);
    expect((await firmWording(db, firm))['line:confirmation_sent:feed']?.words).toBe('Confirmed {customer’s} visit.');
    await expect(setWording(db, firm, 'line:confirmation_sent:feed', 'Confirmed {time}.', frontline, null)).rejects.toThrow(Refused);
    await expect(setWording(db, firm, 'line:nothing:feed' as never, 'Confirmed.', frontline, null)).rejects.toThrow(Refused);
    await expect(setWording(db, firm, 'line:confirmation_sent:page' as never, 'Confirmed.', frontline, null)).rejects.toThrow(Refused);
    await expect(setWording(db, firm, 'line:confirmation_sent:job', 'Two\nlines.', frontline, null)).rejects.toThrow(Refused);
  });

  it('cannot be done by a customer', async () => {
    const firm = await tidewell(db, '+447700903003');
    await expect(setWording(db, firm, 'text:visit_reminder', 'Reminder: {time}.', { kind: 'customer' }, await agreedByOwner(db, firm))).rejects.toThrow(Refused);
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

describe('stopOrStart', () => {
  it('knows the stop words and start words as the whole text, in any capitals', () => {
    for (const word of ['STOP', 'stop', ' Stop\n', 'STOPALL', 'unsubscribe', 'CANCEL', 'end', 'QUIT']) {
      expect(stopOrStart(word), word).toBe('stop');
    }
    for (const word of ['START', 'start', 'Unstop']) {
      expect(stopOrStart(word), word).toBe('start');
    }
  });

  it('acts on nothing else', () => {
    for (const words of ['', 'Please stop', 'STOP.', 'STOP STOP', 'Cancel the visit', 'yes', 'start now', 'S T O P']) {
      expect(stopOrStart(words), words).toBeNull();
    }
  });
});

describe('quietUntil', () => {
  it('is 8am the next morning from 8pm, 8am the same morning before 8am, and nothing in the day', () => {
    expect(quietUntil(instantFromIso('2026-09-30T20:00:00+01:00'))).toBe(instantFromIso('2026-10-01T08:00:00+01:00'));
    expect(quietUntil(instantFromIso('2026-09-30T23:59:00+01:00'))).toBe(instantFromIso('2026-10-01T08:00:00+01:00'));
    expect(quietUntil(instantFromIso('2026-10-01T00:00:00+01:00'))).toBe(instantFromIso('2026-10-01T08:00:00+01:00'));
    expect(quietUntil(instantFromIso('2026-10-01T07:59:00+01:00'))).toBe(instantFromIso('2026-10-01T08:00:00+01:00'));
    expect(quietUntil(instantFromIso('2026-10-01T08:00:00+01:00'))).toBeNull();
    expect(quietUntil(instantFromIso('2026-10-01T19:59:00+01:00'))).toBeNull();
  });

  it('works in UK time over the clock changes and the end of a month', () => {
    // Saturday 24 October, 21:00 summer time: 8am on Sunday 25th is after the clocks go back.
    expect(quietUntil(instantFromIso('2026-10-24T21:00:00+01:00'))).toBe(instantFromIso('2026-10-25T08:00:00Z'));
    // Saturday 27 March 2027, 22:00: 8am on Sunday 28th is after the clocks go forward.
    expect(quietUntil(instantFromIso('2027-03-27T22:00:00Z'))).toBe(instantFromIso('2027-03-28T08:00:00+01:00'));
    expect(quietUntil(instantFromIso('2026-10-31T20:30:00Z'))).toBe(instantFromIso('2026-11-01T08:00:00Z'));
    // Every time in the acceptance story is in the day.
    for (const at of ['2026-09-28T11:16:00+01:00', '2026-09-30T13:00:00+01:00', '2026-10-15T08:11:00+01:00', '2026-10-18T13:00:00+01:00', '2026-10-25T13:00:00Z']) {
      expect(quietUntil(instantFromIso(at)), at).toBeNull();
    }
  });
});
