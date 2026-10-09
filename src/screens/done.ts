// Done for you, as the example draws it (feedScreen in
// reference/example-app/src.html), from the record: today, then yesterday,
// each newest first, with how many.

import type { Instant } from '../clock';
import { inLondon, londonDayAround, startOfLondonDay } from '../london';
import type { RecordDb } from '../record/db';
import type { Firm } from '../record/types';
import { APP_WORDS } from '../words';
import { feedBetween, feedList } from './feed';
import { html, type Html } from './html';
import { backTo, head } from './shell';

export async function doneScreen(db: RecordDb, firm: Firm, now: Instant): Promise<Html> {
  const today = londonDayAround(now);
  const { year, month, day } = inLondon(now);
  const yesterdayFrom = startOfLondonDay(year, month, day - 1);
  const todays = await feedBetween(db, firm.id, today.from, today.to);
  const yesterdays = await feedBetween(db, firm.id, yesterdayFrom, today.from);
  const count = (n: number) => html`<span class="count">${n}</span>`;

  return html`${backTo('/')}
<div class="block"><h1>${APP_WORDS.doneForYou}</h1><p class="meta">${APP_WORDS.doneForYouMeta}</p></div>
<section class="block">${head(APP_WORDS.today, count(todays.length))}${feedList(todays, APP_WORDS.nothingYetToday)}</section>
<section class="block">${head(APP_WORDS.yesterday, count(yesterdays.length))}${feedList(yesterdays, APP_WORDS.nothingYesterday)}</section>`;
}
