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
}
