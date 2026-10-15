// Vapi's agents through Vapi's own API, with the copy's Vapi private key. Used
// on practice and live only, and only once Greg has set VAPI_API_KEY for that
// copy; this machine and the tests use the stand-in in fake.ts, and the tests
// of this file use a pretend network.
//
// GET /assistant/{id} and PATCH /assistant/{id}, as scripts/vapi-assistant.js
// has used them on practice since 12 Oct 2026. POST /assistant makes one,
// answering 201 with its `id`, from Vapi's documentation read on 15 Oct 2026. The key is sent to Vapi and
// nowhere else, and never logged.

import type { AgentSettings } from '../../agent-settings';
import { VAPI_ID, type AgentAnswer, type CreateAnswer, type VapiAgents } from '.';

const VAPI_API = 'https://api.vapi.ai';

export class VapiApi implements VapiAgents {
  private readonly key: string;
  private readonly send: typeof fetch;

  /** The network can be a pretend one, in the tests of this file. */
  constructor(key: string, network: typeof fetch = fetch) {
    this.key = key;
    this.send = network;
  }

  read(assistant: string): Promise<AgentAnswer> {
    return this.ask(assistant, 'GET');
  }

  change(assistant: string, settings: AgentSettings): Promise<AgentAnswer> {
    return this.ask(assistant, 'PATCH', settings);
  }

  async create(settings: AgentSettings): Promise<CreateAnswer> {
    let answer: Response;
    try {
      answer = await this.send(`${VAPI_API}/assistant`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
    } catch {
      return { ok: false, why: 'unclear' };
    }
    // A refusal of the request itself is certain; anything else may have made one.
    if (answer.status >= 400 && answer.status < 500 && answer.status !== 408 && answer.status !== 429) return { ok: false, why: 'refused' };
    const made = (await answer.json().catch(() => null)) as { id?: unknown } | null;
    if (!answer.ok || typeof made?.id !== 'string' || !VAPI_ID.test(made.id)) return { ok: false, why: 'unclear' };
    return { ok: true, assistant: made.id };
  }

  private async ask(assistant: string, method: 'GET' | 'PATCH', body?: AgentSettings): Promise<AgentAnswer> {
    if (!VAPI_ID.test(assistant)) return { ok: false, why: 'not_found', status: null };
    let answer: Response;
    try {
      answer = await this.send(`${VAPI_API}/assistant/${assistant}`, {
        method,
        headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      return { ok: false, why: 'unreachable', status: null };
    }
    if (answer.status === 404) return { ok: false, why: 'not_found', status: 404 };
    if (answer.status === 429 || answer.status >= 500) return { ok: false, why: 'unreachable', status: answer.status };
    if (!answer.ok) return { ok: false, why: 'refused', status: answer.status };
    const agent: unknown = await answer.json().catch(() => null);
    if (typeof agent !== 'object' || agent === null || Array.isArray(agent)) return { ok: false, why: 'unreachable', status: answer.status };
    return { ok: true, agent: agent as AgentSettings };
  }
}
