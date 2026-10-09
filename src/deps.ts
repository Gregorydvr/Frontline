import type { Clock } from './clock';
import type { DueQueue } from './due';
import type { StaffGate } from './providers/access';
import type { FileStores } from './record/files';
import type { Texts } from './providers/texts';

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
}

/** The copy a deployed Worker is, from its COPY setting. Anything but "practice" is live. */
export function copyFrom(setting: string | undefined): Copy {
  return setting === 'practice' ? 'practice' : 'live';
}

/** An address from a copy's setting, such as LINK_ADDRESS or PUBLIC_ADDRESS: no slash at the end, and null when empty. */
export function linkAddressFrom(setting: string | undefined): string | null {
  const address = (setting ?? '').trim().replace(/\/+$/, '');
  return address === '' ? null : address;
}
