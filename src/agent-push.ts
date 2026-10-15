// Putting the record's settings on a firm's voice agent in Vapi (task 3 of
// docs/autopilot.md; plan J2 in docs/plan-automation.md), the way
// scripts/vapi-assistant.js does on Greg's machine: read what Vapi holds
// first, send only the settings that differ, then read it back and compare.
//
// It runs from a row in the due list after a change the agent is made from is
// saved, such as the urgent list, and when a member of staff asks in the
// control room. Every run is written to the firm's log of pushes, never
// edited. It changes nothing on Vapi when:
// - this copy has no Vapi key (it is switched off until Greg sets one)
// - the agent's recording path is not this firm's own: it is not this firm's
//   agent, and a push would answer one firm's calls in another's name
// - Vapi holds something other than what Front-line last confirmed, or than
//   the record, such as a change made in Vapi's dashboard: staff are shown
//   which settings differ, and choose whether to put the record's on it
//
// Running it twice does no harm: the second run finds nothing to send.

import {
  agentSettingsFor,
  differingSettings,
  holdsASecret,
  settingsFingerprint,
  type AgentSettings,
} from './agent-settings';
import type { Deps } from './deps';
import { log } from './log';
import { getAgent, getFirm, recordAgentPush } from './record';
import { Refused, type RecordDb } from './record/db';
import type { AgentOutcome, AgentState, DueId, FirmId, StaffId } from './record/types';

/** What a push needs from outside: Vapi (null while this copy has no key), and what the copy gives the agent. */
export type PushDeps = Partial<Pick<Deps, 'agents' | 'appAddress' | 'vapiCredential'>>;

/** Who asked, which row it ran from, and whether staff chose to replace what Vapi holds. */
export interface PushHow {
  by: { kind: 'frontline' } | { kind: 'staff'; staff: StaffId };
  due: DueId | null;
  /** Staff saw what differs and chose to put the record's settings on it anyway. Never for an agent that is not this firm's. */
  overwrite: boolean;
}

/** What came of it, and whether to try again later because Vapi could not be reached. Null when the firm has no agent set. */
export type Pushed = { outcome: AgentOutcome; tryAgain: boolean } | null;

export async function pushAgent(db: RecordDb, deps: PushDeps, firm: FirmId, how: PushHow): Promise<Pushed> {
  const [firmNow, agent] = [await getFirm(db, firm), await getAgent(db, firm)];
  if (firmNow === null || agent === null) return null;
  const id = agent.assistantId;

  const done = async (
    outcome: AgentOutcome,
    state: AgentState,
    found: { settings?: readonly string[]; differing?: readonly string[]; confirmed?: string } = {},
  ): Promise<Pushed> => {
    await recordAgentPush(db, firm, {
      assistantId: id,
      by: how.by,
      due: how.due,
      outcome,
      settings: found.settings ?? [],
      state,
      differing: found.differing ?? [],
      ...(found.confirmed === undefined ? {} : { confirmed: found.confirmed }),
    });
    logPush(firm, outcome, found.settings?.length ?? 0);
    return { outcome, tryAgain: outcome === 'unreachable' };
  };

  const vapi = deps.agents ?? null;
  if (vapi === null) return done('not_connected', 'stuck');
  const built = agentSettingsFor(firmNow, { appAddress: deps.appAddress ?? null, credential: deps.vapiCredential ?? null });
  if ('notReady' in built) return done('not_ready', 'stuck');
  const wanted = built.settings;
  // Never: the template holds no secret, and a test keeps it so.
  if (holdsASecret(wanted)) throw new Refused();
  const wantedPrint = await settingsFingerprint(wanted);

  const read = await vapi.read(id);
  if (!read.ok) return done(read.why, read.why === 'unreachable' ? 'behind' : 'stuck');
  if (recordingPathOf(read.agent) !== `/firms/${firm}`) return done('not_this_firms', 'stuck');

  const differing = differingSettings(read.agent, wanted);
  if (differing.length === 0) return done('in_step', 'in_step', { confirmed: wantedPrint });

  // Vapi may change only from what Front-line last confirmed. Anything else
  // was changed outside Front-line, or never confirmed: staff choose.
  const heldPrint = await settingsFingerprint(read.agent);
  if (!how.overwrite && heldPrint !== agent.confirmed) {
    return done('differs', 'differs', { settings: differing, differing });
  }

  const sending: AgentSettings = Object.fromEntries(differing.map((name) => [name, wanted[name]]));
  const changed = await vapi.change(id, sending);
  if (!changed.ok) return done(changed.why, changed.why === 'unreachable' ? 'behind' : 'stuck', { settings: differing, differing });

  const back = await vapi.read(id);
  if (!back.ok) return done(back.why, back.why === 'unreachable' ? 'behind' : 'stuck', { settings: differing, differing });
  const still = differingSettings(back.agent, wanted);
  if (still.length > 0) return done('differs', 'differs', { settings: differing, differing: still });
  return done('changed', 'in_step', { settings: differing, confirmed: wantedPrint });
}

/** The agent's recording path, which names the firm it records for, or null. */
function recordingPathOf(agent: AgentSettings): string | null {
  const plan = agent.artifactPlan;
  if (typeof plan !== 'object' || plan === null) return null;
  const path = (plan as Record<string, unknown>).recordingPath;
  return typeof path === 'string' ? path : null;
}

function logPush(firm: FirmId, outcome: AgentOutcome, sent: number): void {
  switch (outcome) {
    case 'in_step':
      log('agent_in_step', { firm });
      return;
    case 'changed':
      log('agent_changed', { firm, settings: sent });
      return;
    case 'differs':
      log('agent_differs', { firm, settings: sent });
      return;
    case 'unreachable':
      log('agent_unreachable', { firm });
      return;
    case 'not_connected':
    case 'not_ready':
    case 'not_found':
    case 'refused':
    case 'not_this_firms':
      log('agent_stuck', { firm });
      return;
  }
}
