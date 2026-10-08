import { describe, expect, it } from 'vitest';
import { instantFromIso } from '../src/clock';
import { jobState } from '../src/job-state';
import type { VisitState } from '../src/record/types';

const now = instantFromIso('2026-10-15T16:00:00+01:00');
const visit = (at: string, state: VisitState = 'booked') => ({ startsAt: instantFromIso(at), state });

describe('jobState', () => {
  it('is urgent when the job is urgent, whatever its visits', () => {
    expect(jobState({ urgent: true }, [visit('2026-10-15T13:00:00+01:00')], now)).toBe('urgent');
  });

  it('is on today with a booked visit today, even one earlier in the day', () => {
    expect(jobState({ urgent: false }, [visit('2026-10-15T08:30:00+01:00')], now)).toBe('today');
    expect(jobState({ urgent: false }, [visit('2026-10-15T23:30:00+01:00')], now)).toBe('today');
  });

  it('is booked with a booked visit still to come', () => {
    expect(
      jobState({ urgent: false }, [visit('2026-09-28T11:15:00+01:00'), visit('2026-10-19T09:00:00+01:00')], now),
    ).toBe('booked');
  });

  it('has no state with only past or cancelled visits, or none', () => {
    expect(jobState({ urgent: false }, [visit('2026-10-14T10:00:00+01:00')], now)).toBeNull();
    expect(jobState({ urgent: false }, [visit('2026-10-15T10:00:00+01:00', 'cancelled')], now)).toBeNull();
    expect(jobState({ urgent: false }, [visit('2026-10-19T09:00:00+01:00', 'cancelled')], now)).toBeNull();
    expect(jobState({ urgent: false }, [], now)).toBeNull();
  });

  it('takes "today" as the UK date, near midnight in summer time', () => {
    // 00:30 on Thursday in the UK is still Wednesday in UTC.
    const justAfterMidnight = instantFromIso('2026-10-14T23:30:00Z');
    expect(jobState({ urgent: false }, [visit('2026-10-15T09:00:00+01:00')], justAfterMidnight)).toBe('today');
    // A visit just after midnight belongs to tomorrow, not today.
    const lateThursday = instantFromIso('2026-10-15T23:30:00+01:00');
    expect(jobState({ urgent: false }, [visit('2026-10-16T00:15:00+01:00')], lateThursday)).toBe('booked');
  });
});
