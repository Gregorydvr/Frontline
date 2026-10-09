import type { Clock } from './clock';
import type { DueQueue } from './due';
import type { Texts } from './providers/texts';

/**
 * What the system is given from outside, so that tests can give it pretend
 * ones: the clock, the texts provider, and the queue the clock puts due rows
 * on. Later slices add their providers.
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
}

/** The address for customers' links from a copy's setting: no slash at the end, and null when empty. */
export function linkAddressFrom(setting: string | undefined): string | null {
  const address = (setting ?? '').trim().replace(/\/+$/, '');
  return address === '' ? null : address;
}
