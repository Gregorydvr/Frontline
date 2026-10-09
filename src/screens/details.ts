// The page a customer opens from the link in their first text, to check the
// details taken on their call (slice E of docs/build-brief.md). No login: the
// link's token is the key, it cannot be guessed, and it expires (rule 13 in
// CLAUDE.md). The page holds nothing in its address but the token, tells
// search engines to keep out, and is never kept by the browser.
//
// The look is the example app's: its styles, its font, and its buttons and
// fields, copied below from reference/example-app/src.html. The example has
// no such page, so every word here is new, and listed in the pull request.

import type { Instant } from '../clock';
import { startToSay } from '../diary/times';
import { CUSTOMER_LIMITS, type Customer, type Visit } from '../record/types';
import { html, type Html } from './html';
import { page, PAGE_HEADERS } from './page';

/** The words on the page. New in slice E; flagged in its pull request. */
export const DETAILS_WORDS = {
  title: 'Your details',
  intro: '{firm} took these down when you rang. Please check them, and put right anything that’s wrong.',
  visit: 'Your visit',
  name: 'Your name',
  address: 'Address for the visit',
  email: 'Email (if you’d like to give one)',
  save: 'Save my details',
  missing: 'Please give your name and the address for the visit.',
  badEmail: 'That email address doesn’t look right. Please check it, or leave it empty.',
  thanksTitle: 'Thank you',
  thanks: 'Your details are saved. {firm} can see them now.',
  expiredTitle: 'This link has expired',
  expired: 'If anything needs changing, just reply to the text the link came in.',
} as const;

/** The buttons and fields, from the example app's styles. */
const FORM_LOOK =
  '.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:0 16px;border:0;border-radius:10px;font-weight:600;font-size:16px;line-height:1.1;text-decoration:none;white-space:nowrap}' +
  '.btn-ink{background:var(--ink);color:var(--cream)}.btn-ink:hover{background:#151A2C}' +
  '.btn-lg{min-height:56px;font-size:18px;border-radius:12px}.btn-block{width:100%}' +
  '.field{display:flex;flex-direction:column;gap:6px}.field label{font-weight:600}' +
  'input{font:inherit;color:inherit}' +
  '.field input{width:100%;min-height:48px;padding:10px 12px;border:1.5px solid var(--line-strong);border-radius:10px;background:var(--card)}' +
  '.form{display:flex;flex-direction:column;gap:16px}' +
  '.problem{color:var(--error);font-weight:600}';

/**
 * What every response from the page is sent with: those of the owner's
 * screens, with one change: the page's own form may post back to it.
 */
export const DETAILS_HEADERS: Readonly<Record<string, string>> = {
  ...PAGE_HEADERS,
  'Content-Security-Policy':
    "default-src 'none'; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};

/** What the form shows: what is held, or what the customer just sent with what was wrong with it. */
export interface DetailsForm {
  name: string;
  address: string;
  email: string;
  problem: 'missing' | 'bad_email' | null;
}

export function detailsPage(
  firmName: string,
  visit: Pick<Visit, 'startsAt'> | null,
  form: DetailsForm,
): string {
  const problem = form.problem === null ? null : form.problem === 'missing' ? DETAILS_WORDS.missing : DETAILS_WORDS.badEmail;
  return page(
    DETAILS_WORDS.title,
    html`<div class="top-gap" aria-hidden="true"></div>
<div class="block"><h1>${DETAILS_WORDS.title}</h1><p class="meta">${DETAILS_WORDS.intro.replace('{firm}', firmName)}</p></div>
${visit === null ? null : visitCard(visit.startsAt)}
<form class="form" method="post">
${problem === null ? null : html`<p class="problem" role="alert">${problem}</p>`}
${field('name', DETAILS_WORDS.name, form.name, CUSTOMER_LIMITS.name, 'name', 'text')}
${field('address', DETAILS_WORDS.address, form.address, CUSTOMER_LIMITS.address, 'street-address', 'text')}
${field('email', DETAILS_WORDS.email, form.email, CUSTOMER_LIMITS.email, 'email', 'email')}
<button class="btn btn-ink btn-lg btn-block" type="submit">${DETAILS_WORDS.save}</button>
</form>`,
    FORM_LOOK,
  );
}

export function detailsSavedPage(firmName: string): string {
  return page(
    DETAILS_WORDS.thanksTitle,
    html`<div class="top-gap" aria-hidden="true"></div>
<div class="block"><h1>${DETAILS_WORDS.thanksTitle}</h1><p class="meta">${DETAILS_WORDS.thanks.replace('{firm}', firmName)}</p></div>`,
  );
}

/** The one page for a link that has expired or never was: it says nothing about which. */
export function linkExpiredPage(): string {
  return page(
    DETAILS_WORDS.expiredTitle,
    html`<div class="top-gap" aria-hidden="true"></div>
<div class="block"><h1>${DETAILS_WORDS.expiredTitle}</h1><p class="meta">${DETAILS_WORDS.expired}</p></div>`,
  );
}

/** The form as it starts: what is held about the customer, and where the job is. */
export function formFromRecord(customer: Customer, place: string): DetailsForm {
  return { name: customer.name, address: customer.address ?? place, email: customer.email ?? '', problem: null };
}

function visitCard(startsAt: Instant): Html {
  return html`<div class="card"><div class="row"><span class="txt"><span class="t1">${DETAILS_WORDS.visit}</span><span class="t2">${startToSay(startsAt)}</span></span></div></div>`;
}

function field(name: string, label: string, value: string, longest: number, autocomplete: string, type: string): Html {
  return html`<div class="field"><label for="${name}">${label}</label><input id="${name}" name="${name}" type="${type}" value="${value}" maxlength="${longest}" autocomplete="${autocomplete}"></div>`;
}
