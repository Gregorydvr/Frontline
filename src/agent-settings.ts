// A firm's voice agent in Vapi, as Front-line's record says it should be: the
// one template in vapi/agent-template.json, with the firm's name, id and
// urgent list, and this copy's address and Vapi credential, filled in.
// vapi/practice-assistant.json is what it gives for the practice firm, and a
// test fails if the two drift apart.
//
// Front-line owns every top-level setting the template names. Vapi replaces
// each top-level setting it is given as a whole, so a change sends the whole
// of each setting that differs, and nothing else.

import template from '../vapi/agent-template.json';
import type { Firm } from './record/types';

/** One top-level setting of an agent, by name, such as `model`. */
export type AgentSettings = Record<string, unknown>;

/** The top-level settings Front-line owns: every one the template names. */
export const OWNED_SETTINGS: readonly string[] = Object.keys(template);

/** What the copy gives the agent: where Vapi reaches Front-line, and the id of the credential Vapi proves itself with. */
export interface AgentCopy {
  /** This copy's address for the owner's app, which the agent's tools and report reach, such as https://app.example. */
  appAddress: string | null;
  /** Vapi's id for the credential that carries this copy's VAPI_SECRET. An id, never the secret itself. */
  credential: string | null;
}

/** Why a firm's agent cannot be made yet. */
export type NotReady = 'no_urgent_list' | 'no_app_address' | 'no_credential';

/** The firm's agent as the record says it should be, or why it cannot be made yet. */
export function agentSettingsFor(firm: Pick<Firm, 'id' | 'name' | 'urgentList'>, copy: AgentCopy): { settings: AgentSettings } | { notReady: NotReady } {
  // The instructions name the urgent list in sentences that need one. A firm
  // with none cannot switch Calls & bookings on, so it has no agent to set.
  if (firm.urgentList.length === 0) return { notReady: 'no_urgent_list' };
  if (copy.appAddress === null) return { notReady: 'no_app_address' };
  if (copy.credential === null) return { notReady: 'no_credential' };
  const gaps: Record<string, string> = {
    '[[firm]]': firm.name,
    '[[firm id]]': firm.id,
    '[[address]]': copy.appAddress,
    '[[credential]]': copy.credential,
    '[[urgent list]]': firm.urgentList.join(', '),
    '[[urgent list, joined with or]]': joinedWithOr(firm.urgentList),
  };
  return { settings: filled(template, gaps) as AgentSettings };
}

/** "a leak", "a leak or a smell of gas", "a leak, a smell of gas or no heating". */
export function joinedWithOr(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} or ${items.at(-1) ?? ''}`;
}

/** The template with every gap filled, in every string, keys and all left as they are. */
function filled(value: unknown, gaps: Record<string, string>): unknown {
  if (typeof value === 'string') {
    return value.replace(/\[\[[a-z ,]+\]\]/g, (gap) => {
      const words = gaps[gap];
      if (words === undefined) throw new Error('A gap in the agent template that nothing fills');
      return words;
    });
  }
  if (Array.isArray(value)) return value.map((item) => filled(item, gaps));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, filled(inner, gaps)]));
  }
  return value;
}

/** Only the settings Front-line owns, from an agent as Vapi holds it. */
export function ownedPart(agent: AgentSettings): AgentSettings {
  return Object.fromEntries(OWNED_SETTINGS.map((name) => [name, agent[name]]));
}

/** The owned settings whose values differ between the two, by name, in the template's order. */
export function differingSettings(held: AgentSettings, wanted: AgentSettings): string[] {
  return OWNED_SETTINGS.filter((name) => !sameSetting(held[name], wanted[name]));
}

/**
 * The same JSON, whatever order the keys are in, and whatever order a
 * schema's `required` fields are in: Vapi reorders them, and the order means
 * nothing. As scripts/vapi-assistant.js compares them.
 */
export function sameSetting(one: unknown, other: unknown): boolean {
  return JSON.stringify(sorted(one)) === JSON.stringify(sorted(other));
}

function sorted(value: unknown, name = ''): unknown {
  if (Array.isArray(value)) {
    const items = value.map((item) => sorted(item));
    return name === 'required' && items.every((item) => typeof item === 'string') ? [...items].sort() : items;
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, sorted(record[key], key)]));
  }
  return value;
}

/** A short fingerprint of the owned settings, so the record can tell later whether Vapi still holds what it last confirmed. */
export async function settingsFingerprint(agent: AgentSettings): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(sorted(ownedPart(agent))));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** A field whose name looks like it holds a secret, as scripts/vapi-settings.js checks. */
const SECRET_NAME = /secret|token|password|api_?key|authorization/i;

/** Whether any field in the settings is named like a secret. Settings sent to Vapi never hold one (rule 12). */
export function holdsASecret(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  return Object.entries(value).some(([name, inner]) => (!Array.isArray(value) && SECRET_NAME.test(name)) || holdsASecret(inner));
}
