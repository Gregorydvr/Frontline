// The go-live gate (task 4 of queue 2 in docs/autopilot.md): what must be true
// before a firm is switched to live, worked out from the record each time it
// is shown. Wherever the record holds the evidence, the check reads it:
// the set-up and its agreed wording, the services chosen, calls and texts
// through the firm's number, and its agent in Vapi in step. Only what the
// record cannot know is ticked by staff: the number approved and registered
// in the firm's name, the end-to-end test call passed, and the
// data-protection items, whose wording is [to agree] with Greg.
//
// Going live, by the one member of staff the copy names (Greg), switches on
// the services the firm chose. Nothing here touches the database.

import { callsSetUpGaps } from './set-up';
import type { Agent, CallId, Firm, FirmWording, Owner } from './record/types';
import type { Instant } from './clock';

/** The data-protection items Front-line ticks for each firm. [to agree] */
export const DATA_PROTECTION_ITEMS = ['dp_agreement', 'dp_privacy_notice', 'dp_ico', 'dp_vapi_region'] as const;
export type DataProtectionItem = (typeof DATA_PROTECTION_ITEMS)[number];

/** The items staff tick by hand: what the record cannot know. */
export const TICKED_ITEMS = ['number_approved', ...DATA_PROTECTION_ITEMS] as const;
export type TickedItem = (typeof TICKED_ITEMS)[number];

/** Every item on the checklist, in the order the control room shows them. */
export const GO_LIVE_CHECKS = [
  'set_up',
  'services',
  'number_approved',
  'number_calls',
  'number_texts_out',
  'number_texts_in',
  'agent_in_step',
  'test_call',
  ...DATA_PROTECTION_ITEMS,
] as const;
export type GoLiveCheck = (typeof GO_LIVE_CHECKS)[number];

/** Where a ticked item stands: the newest tick or untick. */
export interface Tick {
  ticked: boolean;
  at: Instant;
}

/** What the record holds about the firm's number since it was last set, and the checklist's ticks. */
export interface GoLiveEvidence {
  /** Calls to the firm that reached Front-line since its number was set. */
  calls: number;
  /** Texts from its number that the provider reported delivered. */
  textsDelivered: number;
  /** Texts to its number that reached Front-line since it was set. */
  textsIn: number;
  /** The test call staff recorded as passed, if it is one of the firm's calls made since its number was set. */
  testCall: { call: CallId; at: Instant } | null;
  ticks: Readonly<Partial<Record<TickedItem, Tick>>>;
}

/** Everything the checklist is worked out from. */
export interface GoLiveState {
  firm: Firm;
  owners: readonly Owner[];
  wording: FirmWording;
  agent: Agent | null;
  evidence: GoLiveEvidence;
}

/** Each item on the checklist, and whether it is met. */
export function goLiveChecklist(state: GoLiveState): { check: GoLiveCheck; met: boolean }[] {
  const { firm, evidence } = state;
  const ticked = (item: TickedItem) => evidence.ticks[item]?.ticked === true;
  const met: Record<GoLiveCheck, boolean> = {
    // Every gap before Calls & bookings, agreed wording for every text among them.
    set_up: callsSetUpGaps(firm, state.owners, state.wording).length === 0,
    services: firm.servicesChosen.length > 0,
    number_approved: firm.phoneNumber !== null && ticked('number_approved'),
    number_calls: firm.phoneNumber !== null && evidence.calls > 0,
    number_texts_out: firm.phoneNumber !== null && evidence.textsDelivered > 0,
    number_texts_in: firm.phoneNumber !== null && evidence.textsIn > 0,
    agent_in_step: state.agent?.state === 'in_step',
    test_call: evidence.testCall !== null,
    dp_agreement: ticked('dp_agreement'),
    dp_privacy_notice: ticked('dp_privacy_notice'),
    dp_ico: ticked('dp_ico'),
    dp_vapi_region: ticked('dp_vapi_region'),
  };
  return GO_LIVE_CHECKS.map((check) => ({ check, met: met[check] }));
}

/** Whether every item on the checklist is met. */
export function readyToGoLive(state: GoLiveState): boolean {
  return goLiveChecklist(state).every((item) => item.met);
}
