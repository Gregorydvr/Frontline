import { describe, expect, it } from 'vitest';
import { instantFromIso, type Instant } from '../src/clock';
import { clockWords, HISTORY_WORDS, historyLine, whenWords } from '../src/history-lines';
import { idFromBytes } from '../src/ids';
import {
  HISTORY_KINDS,
  LINE_GAPS,
  type CallId,
  type CustomerId,
  type HistoryEntry,
  type HistoryId,
  type HistoryKind,
  type JobId,
  type TextInId,
  type VisitId,
  type VisitKind,
  type WordingId,
} from '../src/record/types';

const at = instantFromIso('2026-10-15T08:10:00+01:00');

function entry(kind: HistoryKind, visit?: { kind: VisitKind; startsAt: Instant }): HistoryEntry {
  return {
    id: idFromBytes(new Uint8Array(16).fill(1)) as HistoryId,
    at,
    by: { kind: 'frontline' },
    kind,
    customer: { id: idFromBytes(new Uint8Array(16).fill(2)) as CustomerId, name: 'Mrs Green' },
    job: idFromBytes(new Uint8Array(16).fill(3)) as JobId,
    visit: visit ? { id: idFromBytes(new Uint8Array(16).fill(4)) as VisitId, ...visit } : null,
    call: null,
    textIn: null,
    textKind: null,
    service: null,
  };
}

/** An entry about a call with no customer, such as a supplier's. */
function callEntry(kind: HistoryKind, call: { caller: string | null; summary: string | null }): HistoryEntry {
  return {
    ...entry(kind),
    customer: null,
    job: null,
    call: { id: idFromBytes(new Uint8Array(16).fill(5)) as CallId, ...call },
  };
}

const mondayQuoteVisit = { kind: 'quote_visit', startsAt: instantFromIso('2026-10-19T09:00:00+01:00') } as const;

describe('historyLine', () => {
  it.each([
    ['call_answered', undefined, 'Answered the call.', 'Call from Mrs Green answered.'],
    ['passed_to_owner', undefined, 'Passed straight to you.', 'Call from Mrs Green. Passed straight to you.'],
    [
      'visit_booked',
      mondayQuoteVisit,
      'Quote visit booked for Monday, 9am.',
      'Booked Mrs Green’s quote visit for Monday, 9am.',
    ],
    ['confirmation_sent', mondayQuoteVisit, 'Sent a confirmation.', 'Sent Mrs Green a confirmation.'],
    [
      'reminder_sent',
      mondayQuoteVisit,
      'Sent a reminder about the visit.',
      'Reminded Mrs Green about the visit.',
    ],
  ] as const)('writes %s on the job page and in Done for you', (kind, visit, job, feed) => {
    expect(historyLine(entry(kind, visit), 'job')).toBe(job);
    expect(historyLine(entry(kind, visit), 'feed')).toBe(feed);
  });

  it('names an install or a service by its own word', () => {
    const install = { kind: 'install', startsAt: instantFromIso('2026-10-20T08:30:00+01:00') } as const;
    const service = { kind: 'service', startsAt: instantFromIso('2026-10-21T14:00:00+01:00') } as const;
    expect(historyLine(entry('visit_booked', install), 'job')).toBe('Install booked for Tuesday, 8:30am.');
    expect(historyLine(entry('visit_booked', install), 'feed')).toBe('Booked Mrs Green’s install for Tuesday, 8:30am.');
    expect(historyLine(entry('reminder_sent', install), 'job')).toBe('Sent a reminder about the install.');
    expect(historyLine(entry('reminder_sent', service), 'feed')).toBe('Reminded Mrs Green about the service.');
    expect(historyLine(entry('visit_booked', service), 'job')).toBe('Service booked for Wednesday, 2pm.');
  });

  it('adds ’s to every name, as the example does', () => {
    const hughes = { ...entry('visit_booked', mondayQuoteVisit), customer: { id: 'x' as CustomerId, name: 'Mr Hughes' } };
    expect(historyLine(hughes, 'feed')).toBe('Booked Mr Hughes’s quote visit for Monday, 9am.');
  });

  it('writes a message taken as the example’s Done for you does', () => {
    const supplier = callEntry('message_taken', { caller: 'a supplier', summary: 'Your order is ready to collect.' });
    expect(historyLine(supplier, 'feed')).toBe('Call from a supplier. Your order is ready to collect.');
    expect(historyLine(supplier, 'job')).toBe('Call from a supplier. Your order is ready to collect.');
    expect(historyLine(callEntry('message_taken', { caller: 'a supplier', summary: null }), 'feed')).toBe(
      'Call from a supplier.',
    );
    expect(() => historyLine(callEntry('message_taken', { caller: null, summary: 'Hello.' }), 'feed')).toThrow(
      RangeError,
    );
    expect(() => historyLine({ ...supplier, call: null }, 'feed')).toThrow(RangeError);
  });

  it('shows the owner nothing for details taken or missing, or for the firm’s set-up', () => {
    for (const kind of [
      'details_taken',
      'details_missing',
      'service_on',
      'service_off',
      'stop_on',
      'stop_off',
      'number_set',
      'urgent_list_set',
    ] as const) {
      expect(historyLine(entry(kind), 'job')).toBeNull();
      expect(historyLine(entry(kind), 'feed')).toBeNull();
    }
  });

  it('has words, or a plain "not shown", for every kind of entry', () => {
    expect(Object.keys(HISTORY_WORDS).sort()).toEqual(Object.keys(HISTORY_KINDS).sort());
  });

  it('uses only gaps it knows how to fill, and no pronouns on the job page', () => {
    for (const words of Object.values(HISTORY_WORDS)) {
      if (words === null) continue;
      expect(words.job ?? '').not.toMatch(/\b(her|his|him|she|he)\b/i);
      for (const form of Object.values(words)) {
        for (const [, gap] of (form ?? '').matchAll(/\{([^{}]+)\}/g)) {
          expect(LINE_GAPS).toContain(gap);
        }
      }
    }
  });

  it('shows a customer’s text on the job page, in their own words, and not in Done for you', () => {
    const text = {
      ...entry('text_received'),
      by: { kind: 'customer' } as const,
      textIn: { id: idFromBytes(new Uint8Array(16).fill(6)) as TextInId, words: 'Yes please. A Wednesday afternoon if you can.' },
    };
    expect(historyLine(text, 'job')).toBe('Text: “Yes please. A Wednesday afternoon if you can.”');
    expect(historyLine(text, 'feed')).toBeNull();
    expect(() => historyLine({ ...text, textIn: null }, 'job')).toThrow(RangeError);
  });

  it('shows a customer’s STOP and START on the job page, and not in Done for you', () => {
    const by = { kind: 'customer' } as const;
    expect(historyLine({ ...entry('opted_out'), by, textKind: 'every' }, 'job')).toBe('No more texts will go to them.');
    expect(historyLine({ ...entry('opted_in'), by, textKind: 'every' }, 'job')).toBe('Texts can go to them again.');
    for (const kind of ['opted_out', 'opted_in'] as const) {
      expect(historyLine(entry(kind), 'feed')).toBeNull();
    }
  });

  it('shows the owner nothing for their own mobile being set', () => {
    expect(historyLine(entry('owner_mobile_set'), 'job')).toBeNull();
    expect(historyLine(entry('owner_mobile_set'), 'feed')).toBeNull();
  });

  it('uses the firm’s own words for a line when it has them, with the same gaps', () => {
    const own = {
      'line:confirmation_sent:feed': { id: idFromBytes(new Uint8Array(16).fill(7)) as WordingId, words: 'Confirmed {customer}’s visit.' },
    };
    expect(historyLine(entry('confirmation_sent'), 'feed', own)).toBe('Confirmed Mrs Green’s visit.');
    // Only the line it is for.
    expect(historyLine(entry('confirmation_sent'), 'job', own)).toBe('Sent a confirmation.');
    expect(historyLine(entry('call_answered'), 'feed', own)).toBe('Call from Mrs Green answered.');
  });

  it('refuses to make a line without what it needs', () => {
    expect(() => historyLine(entry('visit_booked'), 'job')).toThrow(RangeError);
    expect(() => historyLine({ ...entry('call_answered'), customer: null }, 'feed')).toThrow(RangeError);
  });
});

describe('whenWords', () => {
  const thursday = instantFromIso('2026-10-15T08:10:00+01:00');

  it.each([
    ['later the same day', '2026-10-15T15:00:00+01:00', 'Thursday, 3pm'],
    ['the next day', '2026-10-16T10:00:00+01:00', 'Friday, 10am'],
    ['six days on', '2026-10-21T14:00:00+01:00', 'Wednesday, 2pm'],
    ['seven days on', '2026-10-22T09:00:00+01:00', 'Thursday 22 October, 9am'],
    ['three weeks on', '2026-11-05T13:30:00Z', 'Thursday 5 November, 1:30pm'],
    ['the next year', '2027-03-29T09:00:00+01:00', 'Monday 29 March 2027, 9am'],
    ['in the past', '2026-10-01T15:00:00+01:00', 'Thursday 1 October, 3pm'],
  ])('writes a visit %s', (_, visit, words) => {
    expect(whenWords(instantFromIso(visit), thursday)).toBe(words);
  });

  it('uses UK time on both sides of the clocks going back', () => {
    // Booked on Friday 23 October in summer time, for Monday 26 October after
    // the clocks go back: 9am in the UK is 09:00 UTC.
    const friday = instantFromIso('2026-10-23T11:00:00+01:00');
    expect(whenWords(instantFromIso('2026-10-26T09:00:00Z'), friday)).toBe('Monday, 9am');
    expect(whenWords(instantFromIso('2026-10-26T09:00:00+01:00'), friday)).toBe('Monday, 8am');
  });

  it('uses UK time after the clocks go forward', () => {
    const friday = instantFromIso('2027-03-26T11:00:00Z');
    expect(whenWords(instantFromIso('2027-03-29T08:00:00Z'), friday)).toBe('Monday, 9am');
  });
});

describe('clockWords', () => {
  it.each([
    [9, 0, '9am'],
    [8, 30, '8:30am'],
    [14, 0, '2pm'],
    [15, 5, '3:05pm'],
    [12, 0, 'midday'],
    [12, 30, '12:30pm'],
    [0, 0, 'midnight'],
    [0, 15, '12:15am'],
    [23, 59, '11:59pm'],
  ])('writes %i:%i as %s', (hour, minute, words) => {
    expect(clockWords(hour, minute)).toBe(words);
  });
});
