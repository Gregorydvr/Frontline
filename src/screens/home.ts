// Home, as the example draws it (home() in reference/example-app/src.html),
// from the record: the firm, today's date, what needs the owner's OK, what
// was done for them today, their services and their rules.
//
// Left out until their releases: the Money block, and anything to approve
// (Release 1 has nothing that needs an OK, so its block says so). Left out
// for good: the example's "Play the example job" and "Example settings".

import type { Instant } from '../clock';
import { inLondon, londonDayAround, MONTHS, WEEKDAYS } from '../london';
import { listCallsBetween } from '../record';
import type { RecordDb } from '../record/db';
import type { Firm } from '../record/types';
import { APP_WORDS, SERVICE_ICONS, SERVICE_WORDS } from '../words';
import { feedBetween, feedList } from './feed';
import { html, type Html } from './html';
import { badge, chev, head, icon, shownServices } from './shell';

/** How many of today's lines Home shows, as in the example. */
const FEED_ON_HOME = 3;

export async function homeScreen(db: RecordDb, firm: Firm, now: Instant): Promise<Html> {
  const today = londonDayAround(now);
  const feed = await feedBetween(db, firm.id, today.from, today.to);
  const callsToday = (await listCallsBetween(db, firm.id, today.from, today.to)).length;

  const services = shownServices(firm).map(
    (service) =>
      html`<a class="row" href="/${service}"><span class="tile">${icon(SERVICE_ICONS[service], '')}</span><span class="txt"><span class="t1">${SERVICE_WORDS[service]}</span><span class="t2">${APP_WORDS.callsAnswered.replace('{count}', String(callsToday))}</span></span>${chev()}</a>`,
  );

  return html`<header class="top">
<svg class="logo" role="img" aria-label="Front-line"><use href="#logo"></use></svg>
<span class="top-acts">
<a class="btn btn-line btn-sm" href="/jobs">${icon('i-search')}${APP_WORDS.find}</a>
<a class="btn btn-line btn-sm" href="/message?from=home">${icon('i-msg')}${APP_WORDS.messageUs}</a>
</span>
</header>
<div class="hello">
<div class="firm"><h1>${firm.name}</h1>${badge(firm)}</div>
<p class="meta">${dayWords(now)}</p>
</div>
<div class="home-grid">
<div>
<section class="block">${head(APP_WORDS.needsYourOk)}<div class="card"><p class="empty">${APP_WORDS.nothingNeedsYou}</p></div></section>
<section class="block">${head(
    APP_WORDS.doneForYouToday,
    feed.length === 0 ? null : html`<a class="link" href="/done">${APP_WORDS.seeAll.replace('{count}', String(feed.length))}</a>`,
  )}${feedList(feed.slice(0, FEED_ON_HOME), APP_WORDS.nothingYetToday)}</section>
</div>
<div></div>
</div>
${services.length === 0 ? null : html`<section class="block only-phone">${head(APP_WORDS.yourServices)}<div class="card">${services}</div></section>`}
<div class="card only-phone"><a class="row" href="/rules"><span class="txt"><span class="t1">${APP_WORDS.yourRules}</span><span class="t2">${APP_WORDS.rulesRow}</span></span>${chev()}</a></div>
<div class="stack"><form method="post" action="/logout"><button class="link" type="submit">${APP_WORDS.logOut}</button></form></div>`;
}

/** "Thursday 15 October", as the example writes today. */
export function dayWords(now: Instant): string {
  const { weekday, day, month } = inLondon(now);
  return `${WEEKDAYS[weekday] ?? ''} ${String(day)} ${MONTHS[month - 1] ?? ''}`;
}
