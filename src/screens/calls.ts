// Calls & bookings, read only, drawn from the record in the example's look
// (sectionScreen in reference/example-app/src.html): today's calls, newest
// first, then the visits still to come.
//
// Not here yet: the example's "Website and email", which is not Release 1,
// and the links from each row to its job page, which comes with slice F.

import type { Instant } from '../clock';
import { capitalised, VISIT_WORDS, whenWords } from '../history-lines';
import { clock24, londonDayAround, shortDate } from '../london';
import { listCallsBetween, listVisitsFrom } from '../record';
import type { RecordDb } from '../record/db';
import type { Call, CallOutcome, DiaryVisit, FirmId } from '../record/types';
import { CALL_OUTCOME_WORDS, CALLS_WORDS, DIARY_WORDS, JOB_STATE_WORDS, SERVICE_WORDS } from '../words';
import { html, type Html } from './html';
import { page } from './page';

/** The screen for a firm as it stands at `now`, with the calls of the UK day that holds `now`. */
export async function callsScreen(db: RecordDb, firm: FirmId, now: Instant): Promise<string> {
  const { from, to } = londonDayAround(now);
  const calls = (await listCallsBetween(db, firm, from, to)).reverse();
  const comingUp = await listVisitsFrom(db, firm, now);

  return page(
    SERVICE_WORDS.calls,
    html`<div class="top-gap" aria-hidden="true"></div>
<div class="block"><h1>${SERVICE_WORDS.calls}</h1><p class="meta">${countWords(calls.length)}</p></div>
${calls.length === 0 ? null : html`<section class="block">${head(CALLS_WORDS.todaysCalls)}<div class="card">${calls.map(callRow)}</div></section>`}
${comingUp.length === 0 ? null : html`<section class="block">${head(CALLS_WORDS.comingUp)}<div class="card">${comingUp.map(diaryRow)}</div></section>`}`,
  );
}

function countWords(count: number): string {
  if (count === 0) return CALLS_WORDS.noneYet;
  if (count === 1) return CALLS_WORDS.answeredOne;
  return CALLS_WORDS.answeredMany.replace('{count}', String(count));
}

function head(title: string): Html {
  return html`<div class="head"><h2>${title}</h2></div>`;
}

/** "Mr Price · 11:02", then the line about the call and what came of it, and its chip. */
function callRow(call: Call): Html {
  const said = [call.summary, outcomeWords(call)].filter((part) => part !== null).join(' ');
  return html`<div class="row"><span class="txt"><span class="t1">${whoRang(call)} · ${clock24(call.startedAt)}</span><span class="t2">${said}</span>${chip(call.outcome)}</span></div>`;
}

function whoRang(call: Call): string {
  if (call.customer !== null) return call.customer.name;
  if (call.caller !== null) return capitalised(call.caller);
  return numberWords(call.from);
}

function outcomeWords(call: Call): string {
  if (call.customer === null && call.caller === null) {
    return CALL_OUTCOME_WORDS.details_missing;
  }
  if (call.outcome === 'booked' && call.visit !== null) {
    return CALL_OUTCOME_WORDS.booked
      .replace('{Visit}', capitalised(VISIT_WORDS[call.visit.kind].name))
      .replace('{when}', whenWords(call.visit.startsAt, call.startedAt));
  }
  return CALL_OUTCOME_WORDS[call.outcome];
}

/** The example's chips: "Passed to you" for an urgent call, "Booked" for a booked one. */
function chip(outcome: CallOutcome): Html | null {
  switch (outcome) {
    case 'urgent':
      return html`<span class="chip chip-ok">${icon('i-alert')}${JOB_STATE_WORDS.urgent}</span>`;
    case 'booked':
      return html`<span class="chip chip-good">${icon('i-cal')}${JOB_STATE_WORDS.booked}</span>`;
    case 'message':
      return null;
  }
}

/** "Fri 16 Oct, 10:00", then "Mr Clarke · Quote visit". */
function diaryRow(visit: DiaryVisit): Html {
  return html`<div class="row"><span class="txt"><span class="t1">${shortDate(visit.startsAt)}, ${clock24(visit.startsAt)}</span><span class="t2">${visit.customer.name} · ${DIARY_WORDS[visit.kind]}</span></span></div>`;
}

function icon(id: string): Html {
  return html`<svg class="i-16" aria-hidden="true"><use href="#${id}"></use></svg>`;
}

/** A number as people write it, such as "07700 900123", or "Number withheld". */
function numberWords(number: string | null): string {
  if (number === null) return CALLS_WORDS.withheld;
  const national = `0${number.slice(3)}`;
  return `${national.slice(0, 5)} ${national.slice(5)}`;
}
