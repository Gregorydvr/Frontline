// Front-line's own diary: the firm's visits and the times held during calls,
// in the record, with the firm's rules for when visits can be booked.

import { instant, type Instant } from '../clock';
import { cancelVisit, getFirm, getVisit, holdTime, listTakenTimes, moveVisit } from '../record';
import type { RecordDb } from '../record/db';
import type { Actor, FirmId, VisitId, VisitKind } from '../record/types';
import type { CallRef, Diary, FreeTime, HoldResult, MoveResult } from '.';
import { isOffered, offeredStarts, reminderDue, visitLength, type LondonDate } from './times';

export function ownDiary(db: RecordDb): Diary {
  return {
    async freeTimes(firm: FirmId, kind: VisitKind, options: { from: LondonDate | null; count: number; call: CallRef | null }): Promise<FreeTime[]> {
      const rules = (await getFirm(db, firm))?.diaryRules ?? null;
      const length = rules === null ? null : visitLength(rules, kind);
      if (rules === null || length === null || options.count < 1) {
        return [];
      }
      const starts = offeredStarts(rules, kind, db.clock.now(), options.from);
      const [first] = starts;
      const last = starts.at(-1);
      if (first === undefined || last === undefined) {
        return [];
      }
      const taken = await listTakenTimes(db, firm, first, instant(last + length), options.call);
      const free: FreeTime[] = [];
      for (const startsAt of starts) {
        const endsAt = instant(startsAt + length);
        if (!taken.some((time) => time.startsAt < endsAt && time.endsAt > startsAt)) {
          free.push({ startsAt, endsAt });
          if (free.length === options.count) break;
        }
      }
      return free;
    },

    async holdForCall(firm: FirmId, call: CallRef, kind: VisitKind, startsAt: Instant): Promise<HoldResult> {
      const rules = (await getFirm(db, firm))?.diaryRules ?? null;
      const length = rules === null ? null : visitLength(rules, kind);
      if (rules === null || length === null || !isOffered(rules, kind, startsAt, db.clock.now())) {
        return { result: 'not_offered' };
      }
      const endsAt = instant(startsAt + length);
      const hold = await holdTime(db, firm, { ...call, kind, startsAt, endsAt });
      return hold === null ? { result: 'taken' } : { result: 'held', hold, startsAt, endsAt };
    },

    async move(firm: FirmId, visit: VisitId, startsAt: Instant, by: Actor): Promise<MoveResult> {
      const found = await getVisit(db, firm, visit);
      if (found?.state !== 'booked') {
        return 'not_booked';
      }
      const rules = (await getFirm(db, firm))?.diaryRules ?? null;
      const length = rules === null ? null : visitLength(rules, found.kind);
      const now = db.clock.now();
      if (rules === null || length === null || startsAt === found.startsAt || !isOffered(rules, found.kind, startsAt, now)) {
        return 'not_offered';
      }
      const reminder = reminderDue(startsAt, now);
      const moved = await moveVisit(
        db,
        firm,
        visit,
        { startsAt, endsAt: instant(startsAt + length) },
        by,
        reminder === null ? [] : [{ action: 'send_reminder', runAt: reminder.runAt, latestAt: reminder.latestAt }],
      );
      return moved ? 'moved' : 'taken';
    },

    cancel(firm: FirmId, visit: VisitId, by: Actor): Promise<boolean> {
      return cancelVisit(db, firm, visit, by);
    },
  };
}
