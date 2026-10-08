// The demo firm in plain text, for /local/example on this machine only: each
// job with its state and history lines, and Done for you for one day. For
// checking the record by eye. It is not one of the owner's screens, which
// come in slice F.

import type { Instant } from '../clock';
import { historyLine } from '../history-lines';
import { jobState } from '../job-state';
import { clock24, inLondon, londonDayAround, MONTHS, shortDate, WEEKDAYS } from '../london';
import {
  getCustomer,
  getFirm,
  historyBetween,
  historyForJob,
  listJobs,
  listOwners,
  listVisitsForJob,
} from '../record';
import type { RecordDb } from '../record/db';
import { SERVICES, type FirmId } from '../record/types';
import { ACTOR_WORDS, JOB_STATE_WORDS, SERVICE_WORDS } from '../words';

/** The firm as it stands at `now`, with Done for you for the UK day that holds `now`. */
export async function showExample(db: RecordDb, firmId: FirmId, now: Instant): Promise<string> {
  const firm = await getFirm(db, firmId);
  if (firm === null) {
    return 'There is no example firm.\n';
  }
  const owners = await listOwners(db, firmId);
  const on = SERVICES.filter((service) => firm.services[service]).map((service) => SERVICE_WORDS[service]);
  const lines = [
    `${firm.name}${firm.isExample ? ' (example)' : ''}`,
    `Owner: ${owners.map((owner) => owner.name).join(', ') || 'none'}`,
    `Services on: ${on.join(', ') || 'none'}`,
    `Stop button: ${firm.stopped ? 'on' : 'off'}`,
    `As it stands on ${longDate(now)} at ${clock24(now)}.`,
    '',
    'JOBS',
  ];

  for (const job of await listJobs(db, firmId)) {
    const customer = await getCustomer(db, firmId, job.customer);
    const state = jobState(job, await listVisitsForJob(db, firmId, job.id), now);
    lines.push(
      '',
      `${customer?.name ?? '?'} · ${job.about} · ${job.place}`,
      state === null ? '(no state yet)' : JOB_STATE_WORDS[state],
    );
    for (const entry of await historyForJob(db, firmId, job.id)) {
      const line = historyLine(entry, 'job');
      if (line !== null) {
        lines.push(`  ${shortDate(entry.at)}  ${clock24(entry.at)}  ${ACTOR_WORDS[entry.by.kind]}: ${line}`);
      }
    }
  }

  const { from, to } = londonDayAround(now);
  lines.push('', `DONE FOR YOU ON ${longDate(now).toUpperCase()}`, '');
  const today = await historyBetween(db, firmId, from, to);
  for (const entry of today.reverse()) {
    const line = historyLine(entry, 'feed');
    if (line !== null) {
      lines.push(`  ${clock24(entry.at)}  ${line}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

/** "Thursday 15 October 2026". */
function longDate(at: Instant): string {
  const { year, month, day, weekday } = inLondon(at);
  return `${WEEKDAYS[weekday] ?? ''} ${String(day)} ${MONTHS[month - 1] ?? ''} ${String(year)}`;
}
