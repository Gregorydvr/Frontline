// A job's page, as the example draws it (jobScreen in
// reference/example-app/src.html), from the record: who and what, its state,
// what happens next, and everything so far, day by day, with who did each
// thing. A text that did not reach the customer says so, in the error
// colour, where it happened.

import type { Instant } from '../clock';
import { historyLine } from '../history-lines';
import { jobState } from '../job-state';
import { clock24, londonDay, shortDate } from '../london';
import {
  firmWording,
  getCustomer,
  getJob,
  historyForJob,
  listDueForVisit,
  listMessagesForJob,
  listVisitsForJob,
} from '../record';
import type { RecordDb } from '../record/db';
import type { Actor, Customer, Firm, JobId, Message } from '../record/types';
import { ACTOR_WORDS, APP_WORDS, TEXT_PROBLEM_WORDS, TEXT_WORDS } from '../words';
import { html, type Html } from './html';
import { backTo, head, stateChip } from './shell';

/** A line on the page: when, who, and the words. */
interface Line {
  at: Instant;
  by: Actor['kind'];
  words: string;
  /** A text that did not reach the customer. */
  bad: boolean;
}

/** The look of each "who" chip, from the example's WHO. */
const WHO_LOOK: Readonly<Record<Actor['kind'], string>> = {
  frontline: 'who-fl',
  staff: 'who-fl',
  owner: 'who-you',
  customer: 'who-cust',
};

/** The job's page, or null when the firm has no such job. */
export async function jobScreen(db: RecordDb, firm: Firm, jobId: JobId, now: Instant): Promise<{ title: string; screen: Html } | null> {
  const job = await getJob(db, firm.id, jobId);
  const customer = job === null ? null : await getCustomer(db, firm.id, job.customer);
  if (job === null || customer === null) {
    return null;
  }
  const visits = await listVisitsForJob(db, firm.id, job.id);
  const state = jobState(job, visits, now);
  const words = await firmWording(db, firm.id);

  const lines: Line[] = [];
  for (const entry of await historyForJob(db, firm.id, job.id)) {
    const line = historyLine(entry, 'job', words);
    if (line !== null) {
      lines.push({ at: entry.at, by: entry.by.kind, words: line, bad: false });
    }
  }
  for (const message of await listMessagesForJob(db, firm.id, job.id)) {
    const problem = textProblem(message, customer);
    if (problem !== null) {
      lines.push({ at: message.createdAt, by: 'frontline', words: problem, bad: true });
    }
  }
  lines.sort((x, y) => x.at - y.at);

  // What happens next: the job is with the owner, or a reminder is waiting.
  let next: string | null = null;
  if (state === 'urgent') {
    next = APP_WORDS.nextUrgent;
  } else {
    for (const visit of visits.filter((one) => one.state === 'booked' && one.startsAt > now)) {
      const dues = await listDueForVisit(db, firm.id, visit.id);
      if (dues.some((due) => due.action === 'send_reminder' && due.state === 'waiting')) {
        next = APP_WORDS.nextReminder;
      }
    }
  }

  return {
    title: customer.name,
    screen: html`${backTo('/jobs')}
<div class="block"><h1>${customer.name}</h1><p class="meta">${job.about} · ${job.place}</p>${stateChip(state)}</div>
${next === null ? null : html`<section class="block">${head(APP_WORDS.whatHappensNext)}<div class="card pad"><p>${next}</p></div></section>`}
<section class="block">${head(APP_WORDS.everythingSoFar)}<div class="card">${byDay(lines, now)}</div></section>`,
  };
}

/** The lines grouped by UK day, as the example's "Today" and "Mon 12 Oct". */
function byDay(lines: readonly Line[], now: Instant): Html[] {
  const days: { day: string; lines: Line[] }[] = [];
  for (const line of lines) {
    const day = londonDay(line.at) === londonDay(now) ? APP_WORDS.today : shortDate(line.at);
    const last = days[days.length - 1];
    if (last?.day === day) {
      last.lines.push(line);
    } else {
      days.push({ day, lines: [line] });
    }
  }
  return days.map(
    (group) =>
      html`<p class="day">${group.day}</p><ul class="tl">${group.lines.map(
        (line) =>
          html`<li${line.bad ? html` class="tl-bad"` : null}><div class="tl-top"><span class="who ${WHO_LOOK[line.by]}">${ACTOR_WORDS[line.by]}</span><time>${clock24(line.at)}</time></div><span>${line.words}</span></li>`,
      )}</ul>`,
  );
}

/** The line for a text to the customer that did not reach them, or null when it went, or was not one of theirs. */
function textProblem(message: Message, customer: Customer): string | null {
  if (message.to.kind !== 'customer' || !(message.kind in TEXT_WORDS)) {
    return null;
  }
  const text = TEXT_WORDS[message.kind as keyof typeof TEXT_WORDS];
  if (message.state === 'failed') {
    return TEXT_PROBLEM_WORDS.failed.replace('{text}', text);
  }
  if (message.state !== 'not_sent') {
    return null;
  }
  switch (message.reason) {
    case 'opted_out':
      return TEXT_PROBLEM_WORDS.optedOut.replace('{text}', text);
    case 'no_mobile':
      return customer.noText === 'withheld' ? TEXT_PROBLEM_WORDS.withheld : TEXT_PROBLEM_WORDS.landline;
    default:
      return TEXT_PROBLEM_WORDS.notSent.replace('{text}', text);
  }
}
