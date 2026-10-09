// Done for you: everything Front-line did in the owner's name, as the
// example's feed shows it. Each line is made from a history entry, newest
// first, and opens its job when it has one.

import type { Instant } from '../clock';
import { historyLine } from '../history-lines';
import { clock24 } from '../london';
import { firmWording, historyBetween } from '../record';
import type { RecordDb } from '../record/db';
import type { FirmId, JobId } from '../record/types';
import { html, type Html } from './html';
import { icon } from './shell';

export interface FeedItem {
  at: Instant;
  job: JobId | null;
  line: string;
}

/** The firm's lines for Done for you, from one instant up to, not including, another, newest first. */
export async function feedBetween(db: RecordDb, firm: FirmId, from: Instant, to: Instant): Promise<FeedItem[]> {
  const words = await firmWording(db, firm);
  const items: FeedItem[] = [];
  for (const entry of await historyBetween(db, firm, from, to)) {
    const line = historyLine(entry, 'feed', words);
    if (line !== null) {
      items.push({ at: entry.at, job: entry.job, line });
    }
  }
  return items.reverse();
}

/** The example's feed list: a tick, the line, and its time. */
export function feedList(items: readonly FeedItem[], empty: string): Html {
  if (items.length === 0) {
    return html`<p class="empty">${empty}</p>`;
  }
  return html`<ul class="feed">${items.map((item) => {
    const inner = html`${icon('i-check', 'i tick')}<span class="ft">${item.line}</span><time>${clock24(item.at)}</time>`;
    return item.job === null
      ? html`<li><div class="fb">${inner}</div></li>`
      : html`<li><a class="fb" href="/jobs/${item.job}">${inner}</a></li>`;
  })}</ul>`;
}
