// The stand-in for Vapi's agents, used on this machine and in tests. It holds
// agents in memory, keeps every request it was asked, and reaches nothing. A
// test can give it an agent, change one behind Front-line's back as someone
// in Vapi's dashboard would, or make the next request fail.

import type { AgentSettings } from '../../agent-settings';
import type { AgentAnswer, VapiAgents } from '.';

export class FakeVapi implements VapiAgents {
  /** The agents it holds, by id. */
  readonly agents = new Map<string, AgentSettings>();
  /** Every request, in order: which agent, and for a change, the names of the settings sent. */
  readonly requests: { assistant: string; method: 'GET' | 'PATCH'; settings: string[] }[] = [];
  /** When true, it answers a change as taken but keeps the old settings, as a read-back that does not match. */
  ignoreChanges = false;
  /** What the next requests get, in place of an answer, first to last. */
  private readonly upcoming: ('unreachable' | 'refused' | 'not_found')[] = [];

  /** Makes the next request get this answer. */
  willAnswer(answer: 'unreachable' | 'refused' | 'not_found'): void {
    this.upcoming.push(answer);
  }

  read(assistant: string): Promise<AgentAnswer> {
    this.requests.push({ assistant, method: 'GET', settings: [] });
    const upcoming = this.upcoming.shift();
    if (upcoming !== undefined) return Promise.resolve({ ok: false, why: upcoming, status: null });
    return Promise.resolve(this.held(assistant));
  }

  change(assistant: string, settings: AgentSettings): Promise<AgentAnswer> {
    this.requests.push({ assistant, method: 'PATCH', settings: Object.keys(settings) });
    const upcoming = this.upcoming.shift();
    if (upcoming !== undefined) return Promise.resolve({ ok: false, why: upcoming, status: null });
    const held = this.agents.get(assistant);
    if (!this.ignoreChanges && held !== undefined) {
      this.agents.set(assistant, structuredClone({ ...held, ...settings }));
    }
    return Promise.resolve(this.held(assistant));
  }

  private held(assistant: string): AgentAnswer {
    const agent = this.agents.get(assistant);
    return agent === undefined ? { ok: false, why: 'not_found', status: 404 } : { ok: true, agent: structuredClone(agent) };
  }
}
