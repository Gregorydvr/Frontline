// Front-line's own diary: the firm's visits and the times held during calls,
// in the record, with the firm's rules for when visits can be booked.

import { instant, type Instant } from '../clock';
import { cancelVisit, getFirm, getVisit, holdTime, listTakenTimes, moveVisit } from '../record';
import type { RecordDb } from '../record/db';
import type { Actor, FirmId, MessageKind, VisitId, VisitKind } from '../record/types';
import type { VisitDue } from '../record/visits';
import type { CallRef, Diary, FreeTime, HoldResult, MoveResult } from '.';
import { followupDue, isOffered, offeredStarts, reminderDue, spreadTimes, visitLength, type LondonDate } from './times';

/**
 * Front-line's own diary, on the record given. `textsOn` is the copy's
 * texts of task 5 that are switched on (TEXTS_ON): moving or cancelling a
 * visit writes their rows only then.
 */
export function ownDiary(db: RecordDb, textsOn: readonly MessageKind[] = []): Diary {
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
        }
      }
      return spreadTimes(free, options.from !== null, options.count);
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
      const dues: VisitDue[] = reminder === null ? [] : [{ action: 'send_reminder', runAt: reminder.runAt, latestAt: reminder.latestAt }];
      if (found.kind === 'quote_visit' && textsOn.includes('visit_followup')) dues.push(followupDue(startsAt));
      // Its confirmation, if still waiting, gives the new time itself; the
      // record writes this only for a customer whose confirmation went.
      if (textsOn.includes('visit_moved_notice')) dues.push({ action: 'send_visit_moved', runAt: now, latestAt: startsAt });
      const moved = await moveVisit(db, firm, visit, { startsAt, endsAt: instant(startsAt + length) }, by, dues);
      return moved ? 'moved' : 'taken';
    },

    cancel(firm: FirmId, visit: VisitId, by: Actor): Promise<boolean> {
      return cancelVisit(db, firm, visit, by, textsOn.includes('visit_cancelled_notice'));
    },
  };
}
