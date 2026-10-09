// Pretend dependencies for tests: the pretend clock, the stand-in for texts,
// a queue that keeps what is put on it, and the local file stores. Tests
// never reach a provider.

import { env } from 'cloudflare:workers';
import type { Clock } from '../../src/clock';
import type { Deps } from '../../src/deps';
import type { DueMessage, DueQueue } from '../../src/due';
import { StandInStaff } from '../../src/providers/access/fake';
import { FakeTexts } from '../../src/providers/texts/fake';

/** A queue that keeps what the clock puts on it, for a test to run by hand. */
export class PretendQueue implements DueQueue {
  readonly bodies: DueMessage[] = [];

  sendBatch(messages: Iterable<{ body: DueMessage }>): Promise<void> {
    for (const message of messages) {
      this.bodies.push(message.body);
    }
    return Promise.resolve();
  }
}

/** Where customers' links go in tests. */
export const LINK_ADDRESS = 'https://links.example';

/** Where the owner's app is in tests. */
export const APP_ADDRESS = 'https://app.example';

/** Where the control room is in tests. */
export const CONTROL_ADDRESS = 'https://control.example';

export interface TestDeps extends Deps {
  texts: FakeTexts;
  queue: PretendQueue;
}

export function testDeps(clock: Clock): TestDeps {
  return {
    clock,
    texts: new FakeTexts(),
    queue: new PretendQueue(),
    linkAddress: LINK_ADDRESS,
    appAddress: APP_ADDRESS,
    copy: 'practice',
    staff: new StandInStaff(),
    controlAddress: CONTROL_ADDRESS,
    // The local file stores the tests run against, kept apart between test files.
    files: { kept: env.FILES, inbox: env.CALLS_IN },
  };
}
