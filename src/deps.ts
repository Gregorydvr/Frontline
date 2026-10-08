import type { Clock } from './clock';

/**
 * What the system is given from outside, so that tests can give it pretend
 * ones: the clock now, and the providers (texts, diary and the rest) as their
 * slices add them.
 */
export interface Deps {
  clock: Clock;
}
