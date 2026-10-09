// The frame of the owner's screens, as the example app draws it: on a phone,
// one column with a Back button at the top of each screen but Home; from
// 960px, the side menu with the firm's name and its services. The pieces
// every screen uses are here too: rows, chips, icons and the Back button.
//
// The example's bottom bar, "Send a voice note or photos", and its "Money
// this week" and "Send it in" are left out: they come with later releases.

import type { JobState } from '../job-state';
import type { Firm } from '../record/types';
import { APP_WORDS, JOB_STATE_CHIPS, JOB_STATE_WORDS, SERVICE_ICONS, SERVICE_WORDS } from '../words';
import { ARCHIVO_FONT_FACE } from './archivo';
import { html, trusted, type Html } from './html';
import { ICONS, LOOK } from './look';

/** Where the owner is, for the side menu. */
export type Place = 'home' | 'calls' | 'jobs' | 'rules' | 'done' | 'job' | null;

/** The screens a Message us panel can be opened over, and the address of each. */
export const SCREEN_ADDRESSES = {
  home: '/',
  calls: '/calls',
  jobs: '/jobs',
  done: '/done',
  rules: '/rules',
} as const;
export type ScreenName = keyof typeof SCREEN_ADDRESSES;

/** The services the app has screens for in Release 1. The others come with their releases. */
export const BUILT_SERVICES = ['calls'] as const;

/** The services to show the owner: switched on for the firm, and built. */
export function shownServices(firm: Firm): (typeof BUILT_SERVICES)[number][] {
  return BUILT_SERVICES.filter((service) => firm.services[service]);
}

export interface Frame {
  title: string;
  /** The firm, for the side menu. Null on the pages for logging in. */
  firm: Firm | null;
  place: Place;
  /** Home is wider on a laptop, as in the example. */
  wide?: boolean;
  /** A panel over the screen, such as Message us. The screen behind cannot be reached until it closes. */
  sheet?: Html | null;
}

export function ownerPage(frame: Frame, screen: Html): string {
  const behind = frame.sheet == null ? null : trusted(' inert');
  return html`<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${frame.title}</title>
<style>${trusted(ARCHIVO_FONT_FACE)}${trusted(LOOK)}</style>
<script src="/app.js" defer></script>
</head>
<body>
${trusted(ICONS)}
<div class="app">
${frame.firm === null ? null : html`<aside class="side" aria-label="${APP_WORDS.menu}"${behind}>${side(frame.firm, frame.place)}</aside>`}
<main class="main"${behind}><div class="screen${frame.wide === true ? ' wide' : ''}">${screen}</div></main>
${frame.sheet == null ? null : html`<div class="sheet-wrap">${frame.sheet}</div>`}
</div>
</body>
</html>
`.text;
}

/**
 * What every owner's page is sent with. Search engines keep out, browsers
 * keep no copy, and the page runs only the app's own script, posts only to
 * the app, and tells other sites nothing of where the owner was.
 */
export const OWNER_HEADERS: Readonly<Record<string, string>> = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'Content-Security-Policy':
    "default-src 'none'; style-src 'unsafe-inline'; font-src data:; script-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
};

/** The side menu on a laptop: the firm, Home, its services, All jobs, Your rules, and Message us. */
function side(firm: Firm, place: Place): Html {
  const here = (name: Place) => (name === place ? trusted(' aria-current="page"') : null);
  return html`<div class="side-brand">
<svg class="logo" role="img" aria-label="Front-line"><use href="#logo"></use></svg>
<div class="side-firm"><span>${firm.name}</span>${badge(firm)}</div>
</div>
<a class="nav" href="/"${here('home')}>${icon('i-home')}<span>${APP_WORDS.home}</span></a>
${shownServices(firm).map((service) => html`<a class="nav" href="/${service}"${here(service)}>${icon(SERVICE_ICONS[service])}<span>${SERVICE_WORDS[service]}</span></a>`)}
<hr>
<a class="nav" href="/jobs"${here('jobs')}>${icon('i-list')}<span>${APP_WORDS.allJobs}</span></a>
<a class="nav" href="/rules"${here('rules')}>${icon('i-rules')}<span>${APP_WORDS.yourRules}</span></a>
<div class="side-end">
<a class="btn btn-line btn-block" href="/message?from=${place !== null && place in SCREEN_ADDRESSES ? place : 'home'}">${icon('i-msg')}${APP_WORDS.messageUs}</a>
</div>`;
}

/** The "Example" badge beside the name of an example firm. */
export function badge(firm: Firm): Html | null {
  return firm.isExample ? html`<span class="badge">${APP_WORDS.example}</span>` : null;
}

export function icon(id: string, look = 'i'): Html {
  return html`<svg class="${look}" aria-hidden="true"><use href="#${id}"></use></svg>`;
}

export function chev(): Html {
  return icon('i-chev', 'i chev');
}

/** The Back button. It goes to the screen above; the app's script makes it go back, when it can. */
export function backTo(address: string): Html {
  return html`<a class="back" href="${address}">${icon('i-back')}${APP_WORDS.back}</a>`;
}

export function head(title: string, right: Html | null = null): Html {
  return html`<div class="head"><h2>${title}</h2>${right}</div>`;
}

/** A job's state, as its chip. */
export function stateChip(state: JobState | null): Html | null {
  if (state === null) return null;
  const { look, icon: id } = JOB_STATE_CHIPS[state];
  return html`<span class="chip ${look}">${icon(id, 'i-16')}${JOB_STATE_WORDS[state]}</span>`;
}
