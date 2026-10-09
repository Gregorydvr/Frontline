// Message us, as the example draws it (its "message" sheet in
// reference/example-app/src.html): a panel over the screen it was opened
// from, where the owner writes to Front-line's staff. Closing it goes back to
// that screen. It works with no script: the panel is drawn with the page.
//
// The example's last line, "Or ring Greg on …", is left out until Greg says
// whether that number may be in the code (a question in the pull request).

import { OWNER_MESSAGE_LIMIT } from '../record/owner-messages';
import { APP_WORDS } from '../words';
import { html, type Html } from './html';
import { icon, SCREEN_ADDRESSES, type ScreenName } from './shell';

/** The panel to write in, with what the owner wrote and what was wrong with it, if anything. */
export function messageSheet(from: ScreenName, words: string, problem: boolean): Html {
  return html`<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="fl-sheet-h">
${top(APP_WORDS.messageTitle, from)}
<form class="stack" method="post" action="/message?from=${from}">
${problem ? html`<p class="problem" role="alert">${APP_WORDS.messageMissing}</p>` : null}
<div class="field"><label for="fl-msg">${APP_WORDS.messageLabel}</label><textarea id="fl-msg" name="words" maxlength="${OWNER_MESSAGE_LIMIT}" placeholder="${APP_WORDS.messagePlaceholder}">${words}</textarea></div>
<button class="btn btn-ink btn-lg btn-block" type="submit" data-busy="${APP_WORDS.sending}">${APP_WORDS.messageSend}</button>
</form>
</div>`;
}

/** The panel once the message is kept: a tick, who will answer, and Done. */
export function messageSentSheet(from: ScreenName): Html {
  return html`<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="fl-sheet-h">
${top(APP_WORDS.messageSentTitle, from)}
<div class="center"><span class="bigtick">${icon('i-check', '')}</span><p>${APP_WORDS.messageSent}</p></div>
<a class="btn btn-ink btn-lg btn-block" href="${SCREEN_ADDRESSES[from]}">${APP_WORDS.done}</a>
</div>`;
}

function top(title: string, from: ScreenName): Html {
  return html`<div class="sheet-top"><h2 id="fl-sheet-h" tabindex="-1">${title}</h2><a class="x" href="${SCREEN_ADDRESSES[from]}" aria-label="${APP_WORDS.close}">${icon('i-x')}</a></div>`;
}
