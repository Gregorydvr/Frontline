// What `npm run practice:gates` (scripts/practice-gates.js) checks, kept apart
// from the network so the tests can run it: customers' links open with no
// Cloudflare Access login, as the Bypass on practice-links allows, and the
// owner's app and the control room still send anyone without one to Access's
// login page (docs/access.md, docs/decisions.md).

/** A link token nobody was ever given: 26 characters of Crockford base 32. */
export const NOBODYS_TOKEN = '00000000000000000000000000';

/** True when an address is Cloudflare Access's own login page. */
function toAccess(location) {
  if (typeof location !== 'string' || location === '') return false;
  try {
    return new URL(location).hostname.endsWith('.cloudflareaccess.com');
  } catch {
    return false;
  }
}

/**
 * Judges what each address answered. `answers` holds, for `links`, `app` and
 * `control`, the status, the Location header, the X-Robots-Tag header and the
 * page's text. Gives one line for each check, and whether it passed.
 */
export function judgeGates(answers) {
  const { links, app, control } = answers;
  return [
    {
      ok: links.status === 404 && !toAccess(links.location) && /This link has expired/.test(links.body ?? ''),
      line: `A customer's link opens with no Access login: Front-line answered ${String(links.status)}${toAccess(links.location) ? ', sent to Access' : ''}.`,
    },
    {
      ok: /noindex/i.test(links.robots ?? ''),
      line: `Search engines are told to keep out of customers' links: ${links.robots ? `"${links.robots}"` : 'nothing said'}.`,
    },
    {
      ok: app.status === 302 && toAccess(app.location),
      line: `The owner's app sends anyone with no Access login to Access: ${String(app.status)}${toAccess(app.location) ? ' to Access' : ''}.`,
    },
    {
      ok: control.status === 302 && toAccess(control.location),
      line: `The control room sends anyone with no Access login to Access: ${String(control.status)}${toAccess(control.location) ? ' to Access' : ''}.`,
    },
  ];
}
