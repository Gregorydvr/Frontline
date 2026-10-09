// The diary: which times are free, holding one during a call, and moving or
// cancelling a visit. An interface, so that a firm's own calendar elsewhere,
// such as Google's, can be put behind it later, firm by firm. Front-line's
// own diary is the one there is (docs/decisions.md).

import type { Instant } from '../clock';
import type { Actor, CallProvider, FirmId, HoldId, VisitId, VisitKind } from '../record/types';
import type { LondonDate } from './times';

export interface FreeTime {
  startsAt: Instant;
  endsAt: Instant;
}

/** Who is booking during a call: the provider's id for the call. */
export interface CallRef {
  provider: CallProvider;
  providerCallId: string;
}

export type HoldResult =
  | { result: 'held'; hold: HoldId; startsAt: Instant; endsAt: Instant }
  /** Someone else has the time. */
  | { result: 'taken' }
  /** The firm does not offer it: outside its hours, today, too far ahead, or not on its pattern of starts. */
  | { result: 'not_offered' };

export type MoveResult = 'moved' | 'taken' | 'not_offered' | 'not_booked';

export interface Diary {
  /**
   * Free times for a kind of visit, earliest first: from the day after
   * today, or from a given day if later, up to `count` of them. A call's own
   * held time counts as free to it.
   */
  freeTimes(firm: FirmId, kind: VisitKind, options: { from: LondonDate | null; count: number; call: CallRef | null }): Promise<FreeTime[]>;
  /** Holds a time for a call that is still going. The same call holding again moves its hold. */
  holdForCall(firm: FirmId, call: CallRef, kind: VisitKind, startsAt: Instant): Promise<HoldResult>;
  /** Moves a booked visit to another time the firm offers, cancelling and writing its reminder. */
  move(firm: FirmId, visit: VisitId, startsAt: Instant, by: Actor): Promise<MoveResult>;
  /** Cancels a booked visit, with its texts still waiting. */
  cancel(firm: FirmId, visit: VisitId, by: Actor): Promise<boolean>;
}
