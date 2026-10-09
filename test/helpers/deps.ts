// Pretend dependencies for tests: the pretend clock, the stand-in for texts,
// and a queue that keeps what is put on it. Tests never reach a provider.

import type { Clock } from '../../src/clock';
import type { Deps } from '../../src/deps';
import type { DueMessage, DueQueue } from '../../src/due';
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

export interface TestDeps extends Deps {
  texts: FakeTexts;
  queue: PretendQueue;
}

export function testDeps(clock: Clock): TestDeps {
  return { clock, texts: new FakeTexts(), queue: new PretendQueue(), linkAddress: LINK_ADDRESS };
}
