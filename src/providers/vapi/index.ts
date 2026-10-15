// Vapi's agents: reading one, and changing some of its settings. Two versions
// sit behind it: Vapi's own API on practice and live, once a copy has a Vapi
// key, and a stand-in on this machine and in tests, so tests never reach Vapi.
//
// Only the control room's push (src/agent-push.ts) uses it. Lint fails Vapi's
// address anywhere outside this folder and the scripts run on Greg's machine.

import type { AgentSettings } from '../../agent-settings';

/** What Vapi answered about an agent. */
export type AgentAnswer =
  /** The agent's settings as Vapi holds them. */
  | { ok: true; agent: AgentSettings }
  /**
   * No agent: Vapi could not be reached or was busy, so try again later
   * (unreachable); it has no agent with that id (not_found); or it refused
   * the request itself, such as settings it no longer takes (refused).
   */
  | { ok: false; why: 'unreachable' | 'not_found' | 'refused'; status: number | null };

export interface VapiAgents {
  /** Reads an agent's settings. */
  read(assistant: string): Promise<AgentAnswer>;
  /** Replaces each of the settings given, whole, and leaves the rest. Gives the agent as Vapi then holds it. */
  change(assistant: string, settings: AgentSettings): Promise<AgentAnswer>;
  /**
   * Makes a new agent with these settings (task 3 of queue 2): only from the
   * control room's guided set-up, once per firm. Unclear: Vapi's answer did
   * not say whether it was made, so staff check Vapi by hand.
   */
  create(settings: AgentSettings): Promise<CreateAnswer>;
}

/** What came of making an agent: its id, or certain it was not made, or not clear. */
export type CreateAnswer = { ok: true; assistant: string } | { ok: false; why: 'refused' | 'unclear' };

/** Vapi's ids for agents and credentials. */
export const VAPI_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
