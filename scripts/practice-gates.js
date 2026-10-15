// Checks the gates in front of practice in one go, as someone with no
// Cloudflare Access login sees them (scripts/gates.js says what passes). Read
// only: three GET requests, with a link token nobody was ever given, so no
// customer's page is opened and nothing is logged in or changed.
//
//   npm run practice:gates
//
// Needs no key or login. It ends with a failure when a check does not pass,
// so it can be run after each deploy to practice.

import { setDefaultResultOrder } from 'node:dns';
import { judgeGates, NOBODYS_TOKEN } from './gates.js';

// Some machines get TLS errors over IPv6 to Cloudflare (docs/practice-checks.md).
setDefaultResultOrder('ipv4first');

const [links, app, control] = process.argv.slice(2);
if (!links || !app || !control) {
  console.error('Usage: node scripts/practice-gates.js <links address> <app address> <control room address>');
  process.exit(1);
}

async function ask(address) {
  const answer = await fetch(address, { redirect: 'manual', headers: { 'Cache-Control': 'no-store' } });
  const type = answer.headers.get('Content-Type') ?? '';
  return {
    status: answer.status,
    location: answer.headers.get('Location'),
    robots: answer.headers.get('X-Robots-Tag'),
    body: type.startsWith('text/html') ? await answer.text() : null,
  };
}

const checks = judgeGates({
  links: await ask(`${links}/d/${NOBODYS_TOKEN}`),
  app: await ask(`${app}/`),
  control: await ask(`${control}/`),
});
for (const check of checks) console.log(`${check.ok ? 'pass' : 'FAIL'}  ${check.line}`);
if (checks.some((check) => !check.ok)) process.exit(1);
