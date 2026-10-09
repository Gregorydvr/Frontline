// The frame of the customer's page and of this machine's own pages: the
// example's look, its font and icons, with no side menu. The owner's screens
// have their own, in shell.ts. Search engines are told to keep out (rule 13
// in CLAUDE.md), and browsers are told not to keep a copy.

import { ARCHIVO_FONT_FACE } from './archivo';
import { html, trusted, type Html } from './html';
import { ICONS, LOOK } from './look';

export function page(title: string, screen: Html, moreLook = ''): string {
  return html`<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${title}</title>
<style>${trusted(ARCHIVO_FONT_FACE)}${trusted(LOOK)}${trusted(moreLook)}</style>
</head>
<body>
${trusted(ICONS)}
<div class="app">
  <main class="main"><div class="screen">${screen}</div></main>
</div>
</body>
</html>
`.text;
}

/** What every page is sent with. The page runs no scripts and loads nothing from elsewhere. */
export const PAGE_HEADERS: Readonly<Record<string, string>> = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};
