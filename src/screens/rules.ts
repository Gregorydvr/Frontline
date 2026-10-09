// Your rules, read only, as the example draws it (rulesScreen in
// reference/example-app/src.html), from the firm's record: for each service
// shown, the rules set up with the owner, then how messages reach customers.
//
// The example's lines for quotes, follow-ups, paperwork and invoices come
// with their releases. Its "Messages to customers" says WhatsApp, which is
// out of date (section 6 of docs/build-brief.md); the words here say text.

import { clockWords } from '../history-lines';
import { WEEKDAYS } from '../london';
import { VISIT_KINDS, type DiaryRules, type Firm } from '../record/types';
import { APP_WORDS, SERVICE_WORDS } from '../words';
import { html, type Html } from './html';
import { backTo, head, icon, shownServices } from './shell';

/** The kinds of visit as a rule names them: "Quote visits go in…". */
const VISITS_WORDS = { quote_visit: 'Quote visits', install: 'Installs', service: 'Services' } as const;

export function rulesScreen(firm: Firm): Html {
  const group = (title: string, lines: readonly string[]) =>
    html`<section class="block">${head(title)}<div class="card pad"><ul class="ticks">${lines.map(
      (line) => html`<li>${icon('i-check')}<span>${line}</span></li>`,
    )}</ul></div></section>`;

  return html`${backTo('/')}
<div class="block"><h1>${APP_WORDS.yourRules}</h1><p class="meta">${APP_WORDS.rulesMeta}</p></div>
${shownServices(firm).map((service) => group(SERVICE_WORDS[service], callsRules(firm)))}
${group(APP_WORDS.messagesToCustomers, [APP_WORDS.rulesByText, APP_WORDS.rulesQuietHours])}
<a class="btn btn-line btn-lg" href="/message?from=rules">${icon('i-msg')}${APP_WORDS.tellUsWhatToChange}</a>`;
}

/** The rules for calls and bookings, from the firm's diary and its urgent list. */
export function callsRules(firm: Firm): string[] {
  const lines: string[] = [APP_WORDS.rulesAnswer];
  if (firm.diaryRules !== null) {
    lines.push(...visitRules(firm.diaryRules));
  }
  if (firm.urgentList.length > 0) {
    lines.push(APP_WORDS.rulesUrgent.replace('{list}', orList(firm.urgentList)));
  }
  return lines;
}

/** "Quote visits go in Monday to Friday, 8am to 4pm.", for each kind of visit the diary books. */
function visitRules(rules: DiaryRules): string[] {
  return VISIT_KINDS.filter((kind) => rules.lengths[kind] !== undefined).map((kind) =>
    APP_WORDS.rulesVisits
      .replace('{Visits}', VISITS_WORDS[kind])
      .replace('{days}', dayWords(rules.days))
      .replace('{opens}', clockWords(Math.floor(rules.opens / 60), rules.opens % 60))
      .replace('{closes}', clockWords(Math.floor(rules.closes / 60), rules.closes % 60)),
  );
}

/** "Monday to Friday" for days in a row, otherwise "Monday, Wednesday and Friday". Days are 0 for Sunday to 6 for Saturday. */
export function dayWords(days: readonly number[]): string {
  // The week as people read it: Monday first, Sunday last.
  const sorted = [...days].sort((x, y) => ((x + 6) % 7) - ((y + 6) % 7));
  const names = sorted.map((day) => WEEKDAYS[day] ?? '');
  const inARow = sorted.every((day, i) => i === 0 || (day + 6) % 7 === ((sorted[i - 1] ?? 0) + 6) % 7 + 1);
  if (sorted.length >= 3 && inARow) {
    return `${names[0] ?? ''} to ${names[names.length - 1] ?? ''}`;
  }
  return orList(names, 'and');
}

/** "a leak", "a leak or no heating", "a leak, no heating or a burst pipe". */
function orList(items: readonly string[], joiner = 'or'): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} ${joiner} ${items[items.length - 1] ?? ''}`;
}
