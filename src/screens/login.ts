// The pages for logging in: asking for a link, the page the link opens, and
// the page for a link that has expired. In the example's look. The example
// has no login, so every word here is new (LOGIN_WORDS in src/words.ts).
//
// The page the link opens shows a button and nothing else: only the tap on
// the button logs in, so a phone's link preview cannot use the link up.

import { LOGIN_WORDS, APP_WORDS } from '../words';
import { html, type Html } from './html';
import { ownerPage } from './shell';

const top = html`<header class="top"><svg class="logo" role="img" aria-label="Front-line"><use href="#logo"></use></svg></header>`;

/** Asking for a link. `job` is the job to land on, kept from the link the owner followed. */
export function loginPage(input: { mobile: string; job: string | null; badMobile: boolean }): string {
  return ownerPage(
    { title: LOGIN_WORDS.title, firm: null, place: null },
    html`${top}
<div class="block"><h1>${LOGIN_WORDS.title}</h1><p class="meta">${LOGIN_WORDS.intro}</p></div>
<form class="stack" method="post" action="/login">
${input.badMobile ? html`<p class="problem" role="alert">${LOGIN_WORDS.badMobile}</p>` : null}
${input.job === null ? null : html`<input type="hidden" name="job" value="${input.job}">`}
<div class="field"><label for="fl-mobile">${LOGIN_WORDS.mobile}</label><input id="fl-mobile" name="mobile" type="tel" inputmode="tel" autocomplete="tel" maxlength="20" value="${input.mobile}"></div>
<button class="btn btn-ink btn-lg btn-block" type="submit" data-busy="${APP_WORDS.sending}">${LOGIN_WORDS.send}</button>
</form>`,
  );
}

/** After asking: the same whatever number was typed, so the page never tells whose it is. */
export function loginSentPage(): string {
  return ownerPage(
    { title: LOGIN_WORDS.sentTitle, firm: null, place: null },
    html`${top}
<div class="block"><h1>${LOGIN_WORDS.sentTitle}</h1><p class="meta">${LOGIN_WORDS.sent}</p></div>
<a class="link" href="/login">${LOGIN_WORDS.sendAnother}</a>`,
  );
}

/** What the link opens: one button that logs in. */
export function loginLinkPage(): string {
  return ownerPage(
    { title: LOGIN_WORDS.linkTitle, firm: null, place: null },
    html`${top}
<div class="block"><h1>${LOGIN_WORDS.linkTitle}</h1><p class="meta">${LOGIN_WORDS.link}</p></div>
<form method="post"><button class="btn btn-ink btn-lg btn-block" type="submit" data-busy="${APP_WORDS.loggingIn}">${LOGIN_WORDS.logIn}</button></form>`,
  );
}

/** One page for a link used, expired or never made: it says nothing about which. */
export function loginExpiredPage(): string {
  return ownerPage(
    { title: LOGIN_WORDS.expiredTitle, firm: null, place: null },
    html`${top}
<div class="block"><h1>${LOGIN_WORDS.expiredTitle}</h1><p class="meta">${LOGIN_WORDS.expired}</p></div>
<a class="btn btn-ink btn-lg btn-block" href="/login">${LOGIN_WORDS.newLink}</a>`,
  );
}

/** A page that is not there, or is another firm's: the same either way. */
export function notFoundScreen(): Html {
  return html`<div class="block"><h1>${APP_WORDS.notFoundTitle}</h1><p class="meta">${APP_WORDS.notFound}</p></div>
<a class="link" href="/">${APP_WORDS.home}</a>`;
}
