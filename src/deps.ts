import type { Clock } from './clock';
import type { DueQueue } from './due';
import type { StaffGate } from './providers/access';
import type { FileStores } from './record/files';
import type { Texts } from './providers/texts';
import type { PhoneNumbers } from './providers/numbers';
import type { StripeBilling } from './providers/stripe';
import type { VapiAgents } from './providers/vapi';
import { MESSAGE_KINDS, type MessageKind } from './record/types';

/**
 * Which copy of the system this is: this machine, practice or live. Only
 * src/local.ts says "local". src/index.ts reads the COPY setting, and
 * anything but "practice", a missing setting included, counts as live, so a
 * slip in set-up hides the practice-only parts of the control room rather
 * than showing them.
 */
export type Copy = 'local' | 'practice' | 'live';

/**
 * What the system is given from outside, so that tests can give it pretend
 * ones: the clock, the texts provider, the queue the clock puts due rows on,
 * and the file stores. Later slices add their providers.
 */
export interface Deps {
  clock: Clock;
  texts: Texts;
  queue: DueQueue;
  /**
   * Where the links customers open are served, such as
   * https://links.example, with no slash at the end. Null until this copy
   * has one (open question 9): then no text with a link goes.
   */
  linkAddress: string | null;
  /**
   * Where the owner's app is served, such as https://app.example, with no
   * slash at the end: the address of the login link and of the urgent
   * alert's link to the job. Null until this copy has one (open question 9):
   * then no login text goes, and the alert goes without its link.
   */
  appAddress: string | null;
  /** Which copy this is. The demo firm's clock and its reset are only on this machine and practice. */
  copy: Copy;
  /** Who the member of staff looking at the control room is: Cloudflare Access's check, or a stand-in on this machine. */
  staff: StaffGate;
  /**
   * Where the control room is served, such as https://control.example, with
   * no slash at the end. It answers there and nowhere else. Null until this
   * copy has one: then the control room is shut.
   */
  controlAddress: string | null;
  /**
   * The file stores: the one that keeps recordings and exports (FILES), and
   * the inbox Vapi writes recordings into (CALLS_IN). Only the record layer
   * touches them (src/record/files.ts).
   */
  files: FileStores;
  /**
   * Vapi's agents, for putting a firm's settings on its voice agent
   * (src/agent-push.ts). Null while this copy has no Vapi key: then nothing
   * reaches Vapi, and each push says it is not connected.
   */
  agents: VapiAgents | null;
  /**
   * Vapi's id for the credential that carries this copy's VAPI_SECRET, which
   * the agent's tools and report present to Front-line. An id, not a secret.
   * Null until this copy has one: then no agent's settings can be made.
   */
  vapiCredential: string | null;
  /**
   * The texts of task 5 this copy switches on, from its TEXTS_ON setting:
   * none, on every copy, until Greg agrees their wording and says so. Only
   * kinds marked switchable can be named; the texts of Release 1 always go.
   */
  textsOn: readonly MessageKind[];
  /**
   * Buying a firm's number in Twilio, from the control room's guided set-up.
   * Null on every copy until its NUMBERS_ON setting is "yes" (it costs
   * money): then the step says it is switched off, and nothing reaches Twilio.
   */
  numbers: PhoneNumbers | null;
  /**
   * The email of the one member of staff who may switch a firm to live
   * (Greg), from the copy's secret GO_LIVE_BY, so it is never in the
   * repository. Null until it is set: then no firm can go live.
   */
  goLiveBy: string | null;
  /**
   * Billing firms through Stripe, in test mode only (task 2 of queue 3).
   * Null unless the copy has one of Stripe's test keys and a product id, and
   * never on live: then going live starts no subscription, and the firm's
   * page says billing is switched off.
   */
  billing: StripeBilling | null;
}

/** The copy a deployed Worker is, from its COPY setting. Anything but "practice" is live. */
export function copyFrom(setting: string | undefined): Copy {
  return setting === 'practice' ? 'practice' : 'live';
}

/** Vapi's id for the copy's credential, from its VAPI_CREDENTIAL_ID setting, or null when it is empty or not an id of Vapi's. */
export function vapiCredentialFrom(setting: string | undefined): string | null {
  const id = (setting ?? '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id) ? id : null;
}

/** The texts a copy's TEXTS_ON setting switches on, such as "visit_moved_notice,visit_followup". Anything that is not a switchable kind is left out. */
export function textsOnFrom(setting: string | undefined): MessageKind[] {
  const named = (setting ?? '').split(',').map((name) => name.trim());
  return (Object.keys(MESSAGE_KINDS) as MessageKind[]).filter((kind) => MESSAGE_KINDS[kind].switchable && named.includes(kind));
}

/** An address from a copy's setting, such as LINK_ADDRESS or PUBLIC_ADDRESS: no slash at the end, and null when empty. */
export function linkAddressFrom(setting: string | undefined): string | null {
  const address = (setting ?? '').trim().replace(/\/+$/, '');
  return address === '' ? null : address;
}
