// All jobs, with the find box, as the example draws it (jobsScreen in
// reference/example-app/src.html), from the record: every job, newest first,
// with its customer, what and where, and its state. The find box looks in the
// customer's name, what the job is and the street. It works with no script:
// the search is sent to this screen. The app's script narrows the list as
// the owner types, as the example does.

import type { Instant } from '../clock';
import { jobState } from '../job-state';
import { londonDayAround } from '../london';
import { listCustomers, listJobs, listVisitsFrom } from '../record';
import type { RecordDb } from '../record/db';
import type { Firm } from '../record/types';
import { APP_WORDS } from '../words';
import { html, type Html } from './html';
import { backTo, chev, stateChip } from './shell';

/** The longest search the find box takes. */
export const FIND_LIMIT = 100;

export async function jobsScreen(db: RecordDb, firm: Firm, now: Instant, find: string): Promise<Html> {
  const names = new Map((await listCustomers(db, firm.id)).map((customer) => [customer.id, customer.name]));
  // Only a visit today or still to come gives a job a state.
  const visits = await listVisitsFrom(db, firm.id, londonDayAround(now).from);
  const wanted = searchWords(find);

  const rows = (await listJobs(db, firm.id))
    .reverse()
    .map((job) => {
      const name = names.get(job.customer) ?? '';
      const words = searchWords(`${name} ${job.about} ${job.place}`);
      const state = jobState(
        job,
        visits.filter((visit) => visit.job === job.id),
        now,
      );
      return {
        shown: wanted === '' || words.includes(wanted),
        row: html`<a class="row" href="/jobs/${job.id}" data-find="${words}"><span class="txt"><span class="t1">${name}</span><span class="t2">${job.about} · ${job.place}</span>${stateChip(state)}</span>${chev()}</a>`,
      };
    });
  const shown = rows.filter((one) => one.shown).map((one) => one.row);

  return html`${backTo('/')}
<div class="block"><h1>${APP_WORDS.allJobs}</h1></div>
<form class="field" method="get" action="/jobs" role="search"><label for="fl-find">${APP_WORDS.findLabel}</label><input class="find" id="fl-find" name="q" type="search" autocomplete="off" maxlength="${FIND_LIMIT}" placeholder="${APP_WORDS.findPlaceholder}" value="${find}"></form>
<div class="card" id="fl-jobs">${
    rows.length === 0
      ? html`<p class="empty">${APP_WORDS.noJobsYet}</p>`
      : html`${shown}<p class="empty" id="fl-none"${shown.length === 0 ? null : html` hidden`}>${APP_WORDS.noMatch}</p>`
  }</div>`;
}

/** Words as the find box compares them: lower case, single spaces, curly apostrophes made straight. */
export function searchWords(text: string): string {
  return text.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
}
